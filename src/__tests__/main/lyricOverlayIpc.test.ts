import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, ipcMain } from 'electron';
import { registerLyricOverlayIpc } from '@/main/ipc/lyricOverlay';
import type { LyricOverlaySnapshot } from '@/shared/lyricOverlay';

const DIST = process.platform === 'win32' ? 'C:\\app\\dist' : '/app/dist';

const SNAPSHOT: LyricOverlaySnapshot = {
  enabled: true,
  visible: true,
  playing: true,
  songId: 'song-1',
  lyricsText: '[00:01.00]第一句',
  positionSec: 2,
  durationSec: 30,
  lyricsSize: 'standard',
};

const MAIN_SENDER = { id: 7 };
const OVERLAY_SENDER = { id: 42 };
const MAIN_FRAME = { url: pathToFileURL(path.join(DIST, 'index.html')).href };

function register() {
  const controller = {
    applySnapshot: vi.fn(),
    getCachedSnapshot: vi.fn(() => SNAPSHOT),
    getOverlayWebContentsId: vi.fn(() => OVERLAY_SENDER.id),
  };
  vi.mocked(ipcMain.on).mockClear();
  vi.mocked(ipcMain.handle).mockClear();
  registerLyricOverlayIpc({
    controller,
    isMainWindowSender: (event) => event.sender.id === MAIN_SENDER.id,
  });
  const stateListener = vi.mocked(ipcMain.on).mock.calls.find(
    ([channel]) => channel === 'lyricOverlay:state',
  )![1] as unknown as (event: any, payload: unknown) => void;
  const getStateHandler = vi.mocked(ipcMain.handle).mock.calls.find(
    ([channel]) => channel === 'lyricOverlay:getState',
  )![1] as unknown as (event: any) => any;
  return { controller, stateListener, getStateHandler };
}

describe('悬浮歌词 IPC（#766）', () => {
  beforeEach(() => {
    vi.mocked(app.getAppPath).mockReturnValue(path.dirname(DIST));
  });

  it('只接受主窗 sender + 可信 URL 的快照，并做形状清洗', () => {
    const { controller, stateListener } = register();
    stateListener({ sender: MAIN_SENDER, senderFrame: MAIN_FRAME }, { ...SNAPSHOT, positionSec: -3 });

    expect(controller.applySnapshot).toHaveBeenCalledWith({ ...SNAPSHOT, positionSec: 0 });
  });

  it('非主窗 sender / 不可信来源 / 非法快照一律丢弃', () => {
    const { controller, stateListener } = register();

    stateListener({ sender: OVERLAY_SENDER, senderFrame: MAIN_FRAME }, SNAPSHOT);
    stateListener(
      { sender: MAIN_SENDER, senderFrame: { url: pathToFileURL(path.resolve(DIST, '..', 'evil.html')).href } },
      SNAPSHOT,
    );
    stateListener({ sender: MAIN_SENDER, senderFrame: MAIN_FRAME }, { ...SNAPSHOT, lyricsSize: 'huge' });
    stateListener({ sender: MAIN_SENDER, senderFrame: MAIN_FRAME }, null);

    expect(controller.applySnapshot).not.toHaveBeenCalled();
  });

  it('getState 只回覆盖层 webContents，返回缓存快照', () => {
    const { controller, getStateHandler } = register();

    expect(getStateHandler({ sender: OVERLAY_SENDER })).toEqual(SNAPSHOT);
    expect(controller.getCachedSnapshot).toHaveBeenCalled();
    expect(() => getStateHandler({ sender: MAIN_SENDER })).toThrow('不受信任');
  });
});
