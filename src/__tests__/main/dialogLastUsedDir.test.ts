import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// #670：Electron 43 起 dialog 不再由 OS 记忆上次目录，本仓需自己跟踪并显式传 defaultPath。
// 顺带定住一个实现陷阱：dialog:openDirectory 同时服务「选下载目录」与「添加本地音乐文件夹」，
// 两者记忆必须按用途分开，否则互相污染。

const DOWNLOADS = '/tmp/mock-downloads';

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'downloads' ? '/tmp/mock-downloads' : '/tmp/mock-user-data') },
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
}));

vi.mock('../../main/services/downloadService', () => ({
  downloadService: { getDownloadPath: vi.fn(() => '/dl'), updateDownloadPath: vi.fn() },
}));
vi.mock('../../main/services/updateService', () => ({
  updateService: { setMainWindow: vi.fn() },
}));
vi.mock('../../main/proxy', () => ({
  applyElectronProxy: vi.fn(),
  buildAgents: vi.fn(),
}));
vi.mock('../../main/storage/db', () => ({
  db: { getSetting: vi.fn(), setSetting: vi.fn() },
}));

import { dialog, ipcMain } from 'electron';
import { db } from '../../main/storage/db';
import { registerDialogIpc } from '../../main/ipc/appSettingsUpdate';

function getHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`${channel} handler not registered`);
  return call[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
}

const settings = new Map<string, unknown>();

// 记忆失效判定走 fs.statSync，所以夹具必须是真实存在的目录，不能是字面量路径。
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-dialog-'));
const existingDir = path.join(tmpRoot, 'music');
fs.mkdirSync(existingDir);
const missingDir = path.join(tmpRoot, 'vanished');

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  vi.mocked(db.getSetting).mockImplementation(async (key: string) => settings.get(key) as never);
  vi.mocked(db.setSetting).mockImplementation(async (key: string, value: unknown) => {
    settings.set(key, value);
  });
});

const DOWNLOAD_KEY = 'dialogLastDir:download';
const LOCAL_MUSIC_KEY = 'dialogLastDir:localMusic';
const TIER3_KEY = 'dialogLastDir:tier3File';

describe('#670 对话框记忆上次使用的目录', () => {
  describe('dialog:openDirectory（选下载目录）', () => {
    it('无记忆时回落 Downloads', async () => {
      registerDialogIpc();
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] } as never);

      await getHandler('dialog:openDirectory')({});

      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: DOWNLOADS }),
      );
    });

    it('有记忆时用记忆目录作为 defaultPath', async () => {
      settings.set(DOWNLOAD_KEY, existingDir);
      registerDialogIpc();
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] } as never);

      await getHandler('dialog:openDirectory')({});

      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: existingDir }),
      );
    });

    it('用户确认后记住所选目录本身', async () => {
      registerDialogIpc();
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [existingDir] } as never);

      await getHandler('dialog:openDirectory')({});

      expect(settings.get(DOWNLOAD_KEY)).toBe(existingDir);
    });

    it('用户取消时不写记忆', async () => {
      settings.set(DOWNLOAD_KEY, existingDir);
      registerDialogIpc();
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] } as never);

      await getHandler('dialog:openDirectory')({});

      expect(db.setSetting).not.toHaveBeenCalled();
    });
  });

  describe('dialog:openDirectory（添加本地音乐文件夹）—— 与下载目录互不污染', () => {
    it('同一个通道按用途分开读写记忆', async () => {
      // 两个键刻意取不同值：同值会让「未被污染」与「本来就是这个值」无法区分。
      const musicLibrary = path.join(tmpRoot, 'library');
      fs.mkdirSync(musicLibrary);
      settings.set(DOWNLOAD_KEY, existingDir);
      registerDialogIpc();
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [musicLibrary] } as never);

      await getHandler('dialog:openDirectory')({}, 'localMusic');

      // 起点取自 localMusic 自己的记忆（此处无记忆）→ 回落 Downloads，而不是沿用 download 的 existingDir
      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: DOWNLOADS }),
      );
      expect(settings.get(LOCAL_MUSIC_KEY)).toBe(musicLibrary);
      expect(settings.get(DOWNLOAD_KEY)).toBe(existingDir);
    });
  });

  describe('dialog:openTier3File（选音源清单）', () => {
    it('记住的是文件所在目录而不是文件本身', async () => {
      const manifestDir = path.join(tmpRoot, 'cfg');
      fs.mkdirSync(manifestDir, { recursive: true });
      const manifest = path.join(manifestDir, 'tier3.json');
      fs.writeFileSync(manifest, '{}', 'utf-8');

      registerDialogIpc();
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [manifest] } as never);

      await getHandler('dialog:openTier3File')({});

      expect(settings.get(TIER3_KEY)).toBe(manifestDir);
    });
  });

  describe('记忆目录已不存在', () => {
    it('回落 Downloads 且不抛错', async () => {
      settings.set(DOWNLOAD_KEY, missingDir);
      registerDialogIpc();
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] } as never);

      await expect(getHandler('dialog:openDirectory')({})).resolves.toBeDefined();
      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: DOWNLOADS }),
      );
    });
  });
});
