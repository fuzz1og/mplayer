import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  LYRIC_OVERLAY_GET_STATE_CHANNEL,
  LYRIC_OVERLAY_STATE_CHANNEL,
  type LyricOverlayBridge,
  type LyricOverlaySnapshot,
} from '../shared/lyricOverlay';

/** 覆盖层专用 preload：只暴露 getState / onState，不提供通用 invoke/send/on（#769）。 */
const bridge: LyricOverlayBridge = {
  getState: () => ipcRenderer.invoke(LYRIC_OVERLAY_GET_STATE_CHANNEL),
  onState: (listener) => {
    const wrapped = (_event: IpcRendererEvent, snapshot: LyricOverlaySnapshot): void => listener(snapshot);
    ipcRenderer.on(LYRIC_OVERLAY_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(LYRIC_OVERLAY_STATE_CHANNEL, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('lyricOverlay', bridge);
