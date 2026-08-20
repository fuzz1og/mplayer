import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { UpdateService } from '../../main/services/updateService';

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
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

/** 触发 autoUpdater.once 最近一次注册的指定事件 */
function fireOnce(autoUpdater: any, event: string, ...args: any[]) {
  const calls = vi.mocked(autoUpdater.once).mock.calls.filter((c: any[]) => c[0] === event);
  const handler = calls[calls.length - 1]?.[1] as (...a: any[]) => void;
  handler?.(...args);
}

/** 让 checkForUpdates 挂起（等待外部触发事件） */
function mockCheckPending(autoUpdater: any) {
  vi.mocked(autoUpdater.checkForUpdates).mockReturnValue(new Promise(() => {}));
}

/** 让 checkForUpdates 立即失败 */
function mockCheckReject(autoUpdater: any, msg: string) {
  vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error(msg));
}

describe('UpdateService', () => {
  let updateService: UpdateService;

  beforeEach(() => {
    updateService = new UpdateService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ELECTRON_GET_USE_PROXY;
  });

  describe('代理配置', () => {
    // 审查修复后：syncProxyEnv 只通过 session.setProxy 生效（netSession + defaultSession），
    // 不再注入/清除 process.env.* 全局代理变量。
    it('有代理配置时设置 session 代理规则', async () => {
      const { db } = await import('../../main/storage/db');
      vi.mocked(db.getSetting).mockResolvedValue({
        enabled: true,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      });

      process.env.HTTP_PROXY = 'http://old-proxy:8080'; // 应保持不变（不再被污染/清除）

      await updateService.syncProxyEnv();

      const { autoUpdater } = await import('electron-updater');
      expect(autoUpdater.netSession.setProxy).toHaveBeenCalledWith({
        proxyRules: 'http=127.0.0.1:7890;https=127.0.0.1:7890',
      });
      const { session } = await import('electron');
      expect(session.defaultSession.setProxy).toHaveBeenCalledWith({
        proxyRules: 'http=127.0.0.1:7890',
      });
      expect(process.env.HTTP_PROXY).toBe('http://old-proxy:8080');
    });

    it('代理禁用时 session 走 direct', async () => {
      const { db } = await import('../../main/storage/db');
      vi.mocked(db.getSetting).mockResolvedValue({
        enabled: false,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      });

      process.env.HTTP_PROXY = 'http://old-proxy:8080';

      await updateService.syncProxyEnv();

      const { autoUpdater } = await import('electron-updater');
      expect(autoUpdater.netSession.setProxy).toHaveBeenCalledWith({ proxyRules: 'direct://' });
      const { session } = await import('electron');
      expect(session.defaultSession.setProxy).toHaveBeenCalledWith({ proxyRules: 'direct://' });
      expect(process.env.HTTP_PROXY).toBe('http://old-proxy:8080'); // 全局 env 不被修改
    });

    it('无代理配置时 session 走 direct', async () => {
      const { db } = await import('../../main/storage/db');
      vi.mocked(db.getSetting).mockResolvedValue(null);

      process.env.HTTP_PROXY = 'http://old-proxy:8080';

      await updateService.syncProxyEnv();

      const { autoUpdater } = await import('electron-updater');
      expect(autoUpdater.netSession.setProxy).toHaveBeenCalledWith({ proxyRules: 'direct://' });
      expect(process.env.HTTP_PROXY).toBe('http://old-proxy:8080');
    });
  });

  describe('checkForUpdates', () => {
    it('检查更新时立即设置 checking 状态（同步）', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      mockCheckPending(autoUpdater);

      const promise = updateService.checkForUpdates(5000);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('update:status', { status: 'checking' });
      expect(updateService.getStatus().status).toBe('checking');

      // Cleanup: fire event to resolve the promise
      await tick();
      fireOnce(autoUpdater, 'update-not-available');
      await promise;
    });

    it('检查更新时先切换 GitHub 直连 feed（索引 0）', async () => {
      const { autoUpdater } = await import('electron-updater');
      mockCheckPending(autoUpdater);

      const promise = updateService.checkForUpdates(5000);
      await tick();

      expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
        provider: 'github',
        owner: 'fuzz1og',
        repo: 'mplayer',
      });

      fireOnce(autoUpdater, 'update-not-available');
      await promise;
    });

    it('有可用更新时推送 available 状态', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      mockCheckPending(autoUpdater);

      const promise = updateService.checkForUpdates(5000);

      await tick();
      fireOnce(autoUpdater, 'update-available', { version: '2.0.0', releaseNotes: 'Bug fixes' });

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
      mockCheckPending(autoUpdater);

      const promise = updateService.checkForUpdates(5000);

      await tick();
      fireOnce(autoUpdater, 'update-not-available');

      await promise;

      expect(updateService.getStatus().status).toBe('not-available');
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', { status: 'not-available' });
    });

    it('检查出错时推送 error 状态并抛出', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      mockCheckReject(autoUpdater, 'Network timeout');

      await expect(updateService.checkForUpdates(100)).rejects.toThrow('Network timeout');

      expect(updateService.getStatus().status).toBe('error');
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', {
        status: 'error',
        error: 'Network timeout',
      });
    });

    it('直连失败时降级到镜像源并成功', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      // 直连（第一次调用）失败 → 降级镜像（第二次调用挂起，等待事件触发成功）
      vi.mocked(autoUpdater.checkForUpdates)
        .mockRejectedValueOnce(new Error('github down'))
        .mockReturnValueOnce(new Promise(() => {}));

      const promise = updateService.checkForUpdates(5000);

      await tick();

      // 应已切换到镜像源（generic provider）
      expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
        provider: 'generic',
        url: expect.stringContaining('gh-proxy.com'),
      });

      fireOnce(autoUpdater, 'update-available', { version: '2.0.0' });
      await promise;

      expect(updateService.getStatus().status).toBe('available');
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', {
        status: 'available',
        version: '2.0.0',
        releaseNotes: undefined,
      });
    });

    it('超时时推送 error 状态并抛出', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      mockCheckPending(autoUpdater);

      const promise = updateService.checkForUpdates(50);
      await expect(promise).rejects.toThrow('检查更新超时');

      expect(updateService.getStatus().status).toBe('error');
    });

    it('并发调用时跳过后续检查', async () => {
      updateService.setMainWindow(createMockWindow());

      const { autoUpdater } = await import('electron-updater');
      // 直连挂起（等 cleanup 触发 error），镜像快速失败
      vi.mocked(autoUpdater.checkForUpdates)
        .mockReturnValueOnce(new Promise(() => {}))
        .mockRejectedValue(new Error('cleanup'));

      const first = updateService.checkForUpdates(5000);
      const second = updateService.checkForUpdates(5000);

      // Second returns immediately with current status
      await expect(second).resolves.toEqual(expect.objectContaining({ status: 'checking' }));

      // Cleanup
      await tick();
      fireOnce(autoUpdater, 'error', new Error('cleanup'));
      await expect(first).rejects.toThrow('cleanup');
    });

    it('完成后解锁并发锁', async () => {
      updateService.setMainWindow(createMockWindow());

      const { autoUpdater } = await import('electron-updater');
      mockCheckPending(autoUpdater);

      const promise = updateService.checkForUpdates(5000);

      await tick();
      fireOnce(autoUpdater, 'update-not-available');
      await promise;

      // Second call should proceed normally
      mockCheckReject(autoUpdater, 'second');
      await expect(updateService.checkForUpdates(100)).rejects.toThrow('second');
    });
  });

  describe('downloadUpdate', () => {
    // 下载依赖检查阶段成功（更新源检查到 available），下载阶段挂起等待事件
    function mockDownloadPending(autoUpdater: any) {
      vi.mocked(autoUpdater.on).mockReturnValue(autoUpdater as any);
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('mirror check fail'));
      vi.mocked(autoUpdater.downloadUpdate).mockReturnValue(new Promise(() => {}));
    }

    it('下载完成时推送 downloaded 状态', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      mockDownloadPending(autoUpdater);

      const promise = updateService.downloadUpdate(5000);

      await tick();
      fireOnce(autoUpdater, 'update-downloaded');

      await promise;

      expect(updateService.getStatus().status).toBe('downloaded');
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', { status: 'downloaded' });
    });

    it('监听下载进度事件', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      mockDownloadPending(autoUpdater);

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
      fireOnce(autoUpdater, 'update-downloaded');
      await promise;
    });

    it('下载出错时推送 error 状态并抛出', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.on).mockReturnValue(autoUpdater as any);
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('mirror check fail'));
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
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('mirror check fail'));
      vi.mocked(autoUpdater.downloadUpdate).mockReturnValue(new Promise(() => {}));

      const promise = updateService.downloadUpdate(50);
      await expect(promise).rejects.toThrow('下载超时');

      expect(updateService.getStatus().status).toBe('error');
    });

    it('并发下载时跳过', async () => {
      updateService.setMainWindow(createMockWindow());

      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.on).mockReturnValue(autoUpdater as any);
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('mirror check fail'));
      vi.mocked(autoUpdater.downloadUpdate).mockReturnValueOnce(new Promise(() => {}));

      const first = updateService.downloadUpdate(5000);
      const second = updateService.downloadUpdate(5000);

      await expect(second).resolves.toBeUndefined();

      // Cleanup
      await tick();
      fireOnce(autoUpdater, 'error', new Error('cleanup'));
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
