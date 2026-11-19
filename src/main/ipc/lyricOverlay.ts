import { ipcMain } from 'electron';
import {
  LYRIC_OVERLAY_GET_STATE_CHANNEL,
  LYRIC_OVERLAY_STATE_CHANNEL,
  sanitizeLyricOverlaySnapshot,
} from '../../shared/lyricOverlay';
import type { LyricOverlayWindowController } from '../lyricOverlay/lyricOverlayWindow';
import { checkTrustedSenderFrame } from './trustedSender';

export interface LyricOverlayIpcDeps {
  controller: Pick<
    LyricOverlayWindowController,
    'applySnapshot' | 'getCachedSnapshot' | 'getOverlayWebContentsId'
  >;
  isMainWindowSender(event: { sender: Electron.WebContents }): boolean;
}

/** 三条通道之外不新增渲染层通用 IPC（ADR 2026-11-19-desktop-lyric-overlay-window §5）。 */
export function registerLyricOverlayIpc(deps: LyricOverlayIpcDeps): void {
  ipcMain.on(LYRIC_OVERLAY_STATE_CHANNEL, (event, payload: unknown) => {
    if (!deps.isMainWindowSender(event)) {
      console.warn('[IPC] 拒绝非主窗来源的悬浮歌词快照');
      return;
    }
    if (checkTrustedSenderFrame(event.senderFrame)) {
      console.warn('[IPC] 拒绝不可信来源的悬浮歌词快照');
      return;
    }
    const snapshot = sanitizeLyricOverlaySnapshot(payload);
    if (!snapshot) {
      console.warn('[IPC] 丢弃形状非法的悬浮歌词快照');
      return;
    }
    deps.controller.applySnapshot(snapshot);
  });

  ipcMain.handle(LYRIC_OVERLAY_GET_STATE_CHANNEL, (event) => {
    if (event.sender.id !== deps.controller.getOverlayWebContentsId()) {
      throw new Error('IPC 来源不受信任');
    }
    return deps.controller.getCachedSnapshot();
  });
}
