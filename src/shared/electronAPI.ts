/**
 * 渲染层 ↔ 主进程 IPC 桥类型（审查修复：contextIsolation 启用后的唯一入口）。
 *
 * preload.ts 在隔离上下文暴露 `window.electronAPI`，渲染层不再拥有 Node/require
 * 能力。签名刻意对齐 ipcRenderer（invoke/send/on/removeListener），渲染层除
 * 引用来源外零改动。
 */

export interface ElectronAPI {
  /** 与 ipcRenderer.invoke 一致：返回 Promise<any>（渲染层按具体通道断言类型）。 */
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  send(channel: string, ...args: unknown[]): void;
  /**
   * 订阅推送事件；返回解绑函数。listener 签名对齐 ipcRenderer.on：
   * (event, ...args: any[])（渲染层既有 handler 形如 `(_event, payload) => …`）。
   */
  on(channel: string, listener: (event: any, ...args: any[]) => void): () => void;
  removeListener(channel: string, listener: (...args: any[]) => void): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
