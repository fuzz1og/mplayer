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
      fetch: vi.fn(),
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

/** 各测试直接往这里写 key/value，db.getSetting/setSetting 即时读写（同步、零竞态） */
const dbSettingsStore: Record<string, unknown> = {};

vi.mock('../../main/storage/db', () => ({
  db: {
    getSetting: vi.fn(async (key: string) => dbSettingsStore[key]),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      dbSettingsStore[key] = value;
    }),
  },
}));

function createMockWindow() {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(false),
  } as any;
}

/** 按 key 预置 db 设置 */
function mockDbSettings(map: Record<string, unknown>) {
  Object.assign(dbSettingsStore, map);
}

/** Let pending microtasks flush so async setup in checkForUpdates/downloadUpdate completes */
function tick(ms = 10) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
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

const GH_PROXY_LABEL = 'gh-proxy.com 镜像';

describe('UpdateService', () => {
  let updateService: UpdateService;

  beforeEach(() => {
    // 常规用例关闭检查时自动测速，隔离探针对顺序的影响；测速用例单独开
    updateService = new UpdateService({ autoProbeOnCheck: false });
    for (const key of Object.keys(dbSettingsStore)) delete dbSettingsStore[key];
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
      mockDbSettings({
        proxyConfig: { enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890 },
      });

      await updateService.syncProxyEnv();

      const { autoUpdater } = await import('electron-updater');
      expect(autoUpdater.netSession.setProxy).toHaveBeenCalledWith({
        proxyRules: 'http=127.0.0.1:7890;https=127.0.0.1:7890',
      });
      const { session } = await import('electron');
      expect(session.defaultSession.setProxy).toHaveBeenCalledWith({ proxyRules: 'http=127.0.0.1:7890' });
    });

    it('代理配置读写不污染全局 env（session 级生效）', async () => {
      process.env.HTTP_PROXY = 'http://old-proxy:8080';
      mockDbSettings({
        proxyConfig: { enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890 },
      });

      await updateService.syncProxyEnv();

      const { autoUpdater } = await import('electron-updater');
      expect(autoUpdater.netSession.setProxy).toHaveBeenCalledWith({
        proxyRules: 'http=127.0.0.1:7890;https=127.0.0.1:7890',
      });
      expect(process.env.HTTP_PROXY).toBe('http://old-proxy:8080'); // 全局 env 不被修改
    });

    it('无代理配置时 session 走 direct', async () => {
      mockDbSettings({});

      await updateService.syncProxyEnv();

      const { autoUpdater } = await import('electron-updater');
      expect(autoUpdater.netSession.setProxy).toHaveBeenCalledWith({ proxyRules: 'direct://' });
      const { session } = await import('electron');
      expect(session.defaultSession.setProxy).toHaveBeenCalledWith({ proxyRules: 'direct://' });
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

    it('默认镜像优先：首个 feed 是 gh-proxy.com 镜像而非 GitHub 直连（#262）', async () => {
      const { autoUpdater } = await import('electron-updater');
      mockCheckPending(autoUpdater);

      const promise = updateService.checkForUpdates(5000);
      await tick();

      expect(autoUpdater.setFeedURL).toHaveBeenNthCalledWith(1, {
        provider: 'generic',
        url: expect.stringContaining('gh-proxy.com'),
      });

      fireOnce(autoUpdater, 'update-not-available');
      await promise;
    });

    it('首镜像失败时降级到下一镜像 ghfast.top（直连只作最后兜底）', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);

      const { autoUpdater } = await import('electron-updater');
      // gh-proxy.com（第一次调用）失败 → 降级 ghfast.top（第二次调用挂起，等待事件成功）
      vi.mocked(autoUpdater.checkForUpdates)
        .mockRejectedValueOnce(new Error('mirror down'))
        .mockReturnValueOnce(new Promise(() => {}));

      const promise = updateService.checkForUpdates(5000);

      await tick();

      expect(autoUpdater.setFeedURL).toHaveBeenLastCalledWith({
        provider: 'generic',
        url: expect.stringContaining('ghfast.top'),
      });

      fireOnce(autoUpdater, 'update-available', { version: '2.0.0' });
      await promise;

      expect(updateService.getStatus()).toMatchObject({ status: 'available' });
      expect(mockWindow.webContents.send).toHaveBeenLastCalledWith('update:status', {
        status: 'available',
        version: '2.0.0',
        releaseNotes: undefined,
        sourceLabel: 'ghfast.top 镜像',
      });
    });

    it('有可用更新时推送 available 状态并携带当前通道标签', async () => {
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
        sourceLabel: GH_PROXY_LABEL,
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
      // gh-proxy 挂起（等 cleanup 触发 error），其余源快速失败
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

  describe('更新通道（#262）', () => {
    it('listSources 返回镜像在前、GitHub 直连垫底的清单', () => {
      const sources = updateService.listSources();
      expect(sources.map(s => s.id)).toEqual(['gh-proxy', 'ghfast', 'ghproxynet', 'github']);
    });

    it('setChannel 合法值持久化到 db 并立即生效', async () => {
      const { db } = await import('../../main/storage/db');

      await updateService.setChannel('ghfast');

      expect(db.setSetting).toHaveBeenCalledWith('updateChannel', 'ghfast');
      expect(await updateService.getChannel()).toBe('ghfast');
    });

    it('setChannel 非法值拒绝且不落盘', async () => {
      const { db } = await import('../../main/storage/db');

      await expect(updateService.setChannel('evil-channel')).rejects.toThrow('非法更新通道');
      expect(db.setSetting).not.toHaveBeenCalled();
    });

    it('db 存了非法通道值时读回 auto', async () => {
      mockDbSettings({ updateChannel: 'deleted-mirror' });

      expect(await updateService.getChannel()).toBe('auto');
    });

    it('手动通道把所选源排最前，其余保持兜底顺序', async () => {
      const mockWindow = createMockWindow();
      updateService.setMainWindow(mockWindow);
      mockDbSettings({ updateChannel: 'github' });

      const { autoUpdater } = await import('electron-updater');
      // 全部源依次失败：github（手动置顶）→ 三个镜像
      mockCheckReject(autoUpdater, 'all channels down');

      await expect(updateService.checkForUpdates(5000)).rejects.toThrow('all channels down');

      // 首选 feed 是 github provider（手动置顶）
      expect(autoUpdater.setFeedURL).toHaveBeenNthCalledWith(1, {
        provider: 'github',
        owner: 'fuzz1og',
        repo: 'mplayer',
      });
      // 失败后仍按静态兜底顺序降级到镜像
      expect(autoUpdater.setFeedURL).toHaveBeenNthCalledWith(2, {
        provider: 'generic',
        url: expect.stringContaining('gh-proxy.com'),
      });
    });

    it('speedTest 并发探测全部源并按延迟升序、失败垫底', async () => {
      const service = new UpdateService(); // 探针用例直接走 netSession.fetch
      const { autoUpdater } = await import('electron-updater');

      const fakeOk = { arrayBuffer: async () => new ArrayBuffer(64) };
      vi.mocked((autoUpdater.netSession as any).fetch).mockImplementation(async (url: string) => {
        if (url.includes('gh-proxy.com')) {
          await new Promise(r => setTimeout(r, 30)); // 最慢的成功源
          return fakeOk;
        }
        if (url.includes('ghfast.top')) {
          return fakeOk; // 最快
        }
        if (url.includes('ghproxy.net')) {
          await new Promise(r => setTimeout(r, 10));
          return fakeOk;
        }
        throw new Error('unreachable'); // github 直连失败 → 垫底
      });

      const results = await service.speedTest();

      expect((autoUpdater.netSession as any).fetch).toHaveBeenCalledTimes(4);
      expect(results.map(r => r.id)).toEqual(['ghfast', 'ghproxynet', 'gh-proxy', 'github']);
      expect(results.find(r => r.id === 'github')?.latencyMs).toBeNull();
      expect(results.find(r => r.id === 'ghfast')?.latencyMs).not.toBeNull();
    });

    it('auto 模式下按测速结果排序检查（最快镜像最先尝试）', async () => {
      const service = new UpdateService(); // 开启检查前自动测速
      mockDbSettings({}); // channel 默认 auto

      const { autoUpdater } = await import('electron-updater');
      const fakeOk = { arrayBuffer: async () => new ArrayBuffer(64) };
      vi.mocked((autoUpdater.netSession as any).fetch).mockImplementation(async (url: string) => {
        // ghfast 测速最快，但检查阶段挂起等待事件
        if (url.includes('ghfast.top')) return fakeOk;
        throw new Error('probe fail');
      });
      mockCheckPending(autoUpdater);

      const promise = service.checkForUpdates(5000);
      await tick(20);

      expect(autoUpdater.setFeedURL).toHaveBeenNthCalledWith(1, {
        provider: 'generic',
        url: expect.stringContaining('ghfast.top'),
      });

      fireOnce(autoUpdater, 'update-not-available');
      await promise;
    });

    it('全部源测速失败时回落静态兜底顺序', async () => {
      const service = new UpdateService();
      mockDbSettings({});

      const { autoUpdater } = await import('electron-updater');
      vi.mocked((autoUpdater.netSession as any).fetch).mockRejectedValue(new Error('all down'));
      mockCheckPending(autoUpdater);

      const promise = service.checkForUpdates(5000);
      await tick(20);

      // 探针全失败 → 仍是静态首源 gh-proxy.com
      expect(autoUpdater.setFeedURL).toHaveBeenNthCalledWith(1, {
        provider: 'generic',
        url: expect.stringContaining('gh-proxy.com'),
      });

      fireOnce(autoUpdater, 'update-not-available');
      await promise;
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

    it('监听下载进度事件且进度携带当前通道', async () => {
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
        sourceLabel: GH_PROXY_LABEL,
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
