import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ElectronAPI } from '../shared/electronAPI';

/**
 * Preload 桥（审查修复：contextIsolation 启用后渲染层不再拥有 Node/require 能力，唯一入口是本桥暴露
 * 的 `window.electronAPI`）。
 */
const listenerMap = new Map<(...args: any[]) => void, (...args: any[]) => void>();

const electronAPI: ElectronAPI = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => {
    ipcRenderer.send(channel, ...args);
  },
  on: (channel, listener) => {
    // 包装监听器（透传 event，签名与 ipcRenderer.on 一致），并记住映射供 removeListener 解绑
    const wrapped = (_event: IpcRendererEvent, ...args: any[]) => listener(_event, ...args);
    listenerMap.set(listener, wrapped);
    ipcRenderer.on(channel, wrapped);
    return () => electronAPI.removeListener(channel, listener);
  },
  removeListener: (channel, listener) => {
    const wrapped = listenerMap.get(listener);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped);
      listenerMap.delete(listener);
    }
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
