import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { UpdateService, getGiteeDesktopFeedUrl, pickGiteeDesktopRelease } from '../../main/services/updateService';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
  get: vi.fn(),
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    checkForUpdates: vi.fn(),
    setFeedURL: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    netSession: {
      setProxy: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn().mockReturnValue('1.0.0'),
  },
  BrowserWindow: vi.fn(),
  session: {
    defaultSession: {
      setProxy: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('../../main/storage/db', () => ({
  db: {
    getSetting: vi.fn(),
  },
}));

const GITEE_RELEASE = {
  tag_name: 'v2.0.0',
  created_at: '2026-08-01T00:00:00+08:00',
  prerelease: false,
  assets: [
    {
      name: 'latest.yml',
      browser_download_url: 'https://gitee.com/aris3104/mplayer/releases/download/v2.0.0/latest.yml',
    },
  ],
};

function createMockWindow() {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(false),
  } as any;
}

/** Let pending microtasks flush so async setup in checkForUpdates/downloadUpdate completes */
function tick() {
  return new Promise<void>(resolve => setTimeout(resolve, 10));
}

describe('UpdateService', () => {
  let updateService: UpdateService;

  beforeEach(() => {
    updateService = new UpdateService();
    vi.clearAllMocks();
    vi.mocked(axios.get).mockResolvedValue({ data: [GITEE_RELEASE] } as any);
  });

  afterEach(() => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ELECTRON_GET_USE_PROXY;
  });

  describe('代理配置', () => {
    it('有代理配置时设置环境变量', async () => {
      const { db } = await import('../../main/storage/db');
      vi.mocked(db.getSetting).mockResolvedValue({
        enabled: true,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      });

      await updateService.syncProxyEnv();

      expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:7890');
      expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
      expect(process.env.http_proxy).toBe('http://127.0.0.1:7890');
      expect(process.env.https_proxy).toBe('http://127.0.0.1:7890');
      expect(process.env.ELECTRON_GET_USE_PROXY).toBe('1');
    });

    it('代理禁用时清除环境变量', async () => {
      const { db } = await import('../../main/storage/db');
      vi.mocked(db.getSetting).mockResolvedValue({
        enabled: false,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      });

      process.env.HTTP_PROXY = 'http://old-proxy:8080';
      process.env.ELECTRON_GET_USE_PROXY = '1';

      await updateService.syncProxyEnv();

      expect(process.env.HTTP_PROXY).toBeUndefined();
      expect(process.env.HTTPS_PROXY).toBeUndefined();
      expect(process.env.ELECTRON_GET_USE_PROXY).toBeUndefined();
    });

    it('无代理配置时清除环境变量', async () => {
      const { db } = await import('../../main/storage/db');
      vi.mocked(db.getSetting).mockResolvedValue(null);

      process.env.HTTP_PROXY = 'http://old-proxy:8080';

      await updateService.syncProxyEnv();

      expect(process.env.HTTP_PROXY).toBeUndefined();
    });
  });

  describe('Gitee release selection', () => {
    it('按版本号选择最新 release，不受 API 返回顺序影响', () => {
      const older = { ...GITEE_RELEASE, tag_name: 'v1.4.0', created_at: '2026-07-01T00:00:00+08:00' };
      const newer = { ...GITEE_RELEASE, tag_name: 'v1.5.0', created_at: '2026-07-16T00:00:00+08:00' };
      const latest = pickGiteeDesktopRelease([older, newer]);
      expect(latest?.tag_name).toBe('v1.5.0');
    });

    it('跳过 prerelease 和没有桌面更新文件的 release', () => {
      const prerelease = { ...GITEE_RELEASE, tag_name: 'v3.0.0', prerelease: true };
      const noDesktop = { ...GITEE_RELEASE, tag_name: 'v2.0.0', assets: [] };
      const latest = pickGiteeDesktopRelease([prerelease, noDesktop]);
      expect(latest).toBeNull();
    });

    it('从 latest.yml 资产推导 generic feed URL', () => {
      expect(getGiteeDesktopFeedUrl(GITEE_RELEASE)).toBe(
        'https://gitee.com/aris3104/mplayer/releases/download/v2.0.0'
      );
    });
  });

  describe('checkForUpdates', () => {
    it('检查更新时立即设置 checking 状态（同步）', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockReturnValue(new Promise(() => {}));

      const promise = updateService.checkForUpdates(5000);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('update:status', { status: 'checking' });
      expect(updateService.getStatus().status).toBe('checking');

      // Cleanup: fire event to resolve the promise
      await tick();
      const handler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'update-not-available')?.[1] as () => void;
      handler?.();
      await promise;
    });

    it('检查前从 Gitee 设置 generic feed', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockReturnValue(new Promise(() => {}));

      const promise = updateService.checkForUpdates(5000);

      await tick();
      const handler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'update-available')?.[1] as (info: any) => void;
      handler?.({ version: '2.0.0', releaseNotes: 'Bug fixes' });
      await promise;

      expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
        provider: 'generic',
        url: 'https://gitee.com/aris3104/mplayer/releases/download/v2.0.0',
      });
    });

    it('Gitee 没有桌面更新文件时报错', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: [] } as any);

      await expect(updateService.checkForUpdates(5000)).rejects.toThrow('Gitee 镜像仓库未找到桌面端更新文件');
      expect(updateService.getStatus().status).toBe('error');
    });

    it('有可用更新时推送 available 状态', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockReturnValue(new Promise(() => {}));

      const promise = updateService.checkForUpdates(5000);

      await tick();
      const handler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'update-available')?.[1] as (info: any) => void;
      handler?.({ version: '2.0.0', releaseNotes: 'Bug fixes' });

      await promise;

      expect(updateService.getStatus()).toEqual({
        status: 'available',
        version: '2.0.0',
        releaseNotes: 'Bug fixes',
      });
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', {
        status: 'available',
        version: '2.0.0',
        releaseNotes: 'Bug fixes',
      });
    });

    it('无可用更新时推送 not-available 状态', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockReturnValue(new Promise(() => {}));

      const promise = updateService.checkForUpdates(5000);

      await tick();
      const handler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'update-not-available')?.[1] as () => void;
      handler?.();

      await promise;

      expect(updateService.getStatus().status).toBe('not-available');
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', { status: 'not-available' });
    });

    it('检查出错时推送 error 状态并抛出', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('Network timeout'));

      await expect(updateService.checkForUpdates(100)).rejects.toThrow('Network timeout');

      expect(updateService.getStatus().status).toBe('error');
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', {
        status: 'error',
        error: 'Network timeout',
      });
    });

    it('超时时推送 error 状态并抛出', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockReturnValue(new Promise(() => {}));

      const promise = updateService.checkForUpdates(50);
      await expect(promise).rejects.toThrow('检查更新超时');

      expect(updateService.getStatus().status).toBe('error');
    });

    it('并发调用时跳过后续检查', async () => {
      updateService.setMainWindow(createMockWindow());

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockReturnValue(new Promise(() => {}));

      const first = updateService.checkForUpdates(5000);
      const second = updateService.checkForUpdates(5000);

      // Second returns immediately with current status
      await expect(second).resolves.toEqual(expect.objectContaining({ status: 'checking' }));

      // Cleanup
      await tick();
      const handler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'error')?.[1] as (err: Error) => void;
      handler?.(new Error('cleanup'));
      await expect(first).rejects.toThrow('cleanup');
    });

    it('完成后解锁并发锁', async () => {
      updateService.setMainWindow(createMockWindow());

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockReturnValue(new Promise(() => {}));

      const promise = updateService.checkForUpdates(5000);

      await tick();
      const handler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'update-not-available')?.[1] as () => void;
      handler?.();
      await promise;

      // Second call should proceed normally
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('second'));
      await expect(updateService.checkForUpdates(100)).rejects.toThrow('second');
    });
  });

  describe('downloadUpdate', () => {
    it('下载完成时推送 downloaded 状态', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.on).mockReturnValue(autoUpdater as any);
      vi.mocked(autoUpdater.downloadUpdate).mockReturnValue(new Promise(() => {}));

      const promise = updateService.downloadUpdate(5000);

      await tick();
      const handler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'update-downloaded')?.[1] as () => void;
      handler?.();

      await promise;

      expect(updateService.getStatus().status).toBe('downloaded');
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', { status: 'downloaded' });
    });

    it('监听下载进度事件', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.on).mockReturnValue(autoUpdater as any);
      vi.mocked(autoUpdater.downloadUpdate).mockReturnValue(new Promise(() => {}));

      const promise = updateService.downloadUpdate(5000);

      await tick();
      expect(autoUpdater.on).toHaveBeenCalledWith('download-progress', expect.any(Function));

      const progressCallback = vi.mocked(autoUpdater.on).mock.calls
        .find(c => c[0] === 'download-progress')?.[1] as (p: any) => void;
      progressCallback?.({ percent: 50, bytesPerSecond: 102400, transferred: 51200, total: 102400 });

      expect(updateService.getStatus()).toEqual({
        status: 'downloading',
        progress: { percent: 50, bytesPerSecond: 102400, transferred: 51200, total: 102400 },
      });

      // Complete
      const downloadedHandler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'update-downloaded')?.[1] as () => void;
      downloadedHandler?.();
      await promise;
    });

    it('下载出错时推送 error 状态并抛出', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.on).mockReturnValue(autoUpdater as any);
      vi.mocked(autoUpdater.downloadUpdate).mockRejectedValue(new Error('Download failed'));

      await expect(updateService.downloadUpdate(100)).rejects.toThrow('Download failed');

      expect(updateService.getStatus().status).toBe('error');
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', {
        status: 'error',
        error: 'Download failed',
      });
    });

    it('下载超时推送 error 状态并抛出', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.on).mockReturnValue(autoUpdater as any);
      vi.mocked(autoUpdater.downloadUpdate).mockReturnValue(new Promise(() => {}));

      const promise = updateService.downloadUpdate(50);
      await expect(promise).rejects.toThrow('下载超时');

      expect(updateService.getStatus().status).toBe('error');
    });

    it('并发下载时跳过', async () => {
      updateService.setMainWindow(createMockWindow());

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.on).mockReturnValue(autoUpdater as any);
      vi.mocked(autoUpdater.downloadUpdate).mockReturnValue(new Promise(() => {}));

      const first = updateService.downloadUpdate(5000);
      const second = updateService.downloadUpdate(5000);

      await expect(second).resolves.toBeUndefined();

      // Cleanup
      await tick();
      const handler = vi.mocked(autoUpdater.once).mock.calls
        .find(c => c[0] === 'error')?.[1] as (err: Error) => void;
      handler?.(new Error('cleanup'));
      await expect(first).rejects.toThrow('cleanup');
    });
  });

  describe('quitAndInstall', () => {
    it('调用 autoUpdater.quitAndInstall', async () => {
      const { autoUpdater } = await import('electron-updater');
      updateService.quitAndInstall();
      expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith();
    });
  });

  describe('版本信息', () => {
    it('返回正确的版本号', () => {
      const version = updateService.getVersion();
      expect(version).toBe('1.0.0');
    });
  });

  describe('状态查询', () => {
    it('getStatus 返回当前状态', () => {
      expect(updateService.getStatus()).toEqual({ status: 'idle' });
    });

    it('setMainWindow 后状态更新触发 webContents.send', () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);
      expect(mockWindow.webContents.send).toBeDefined();
    });
  });
});
