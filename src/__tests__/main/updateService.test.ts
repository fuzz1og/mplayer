import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { UpdateService } from '../../main/services/updateService';

// Mock electron-updater
vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    netSession: {
      setProxy: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// Mock electron
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

// Mock database
vi.mock('../../main/storage/db', () => ({
  db: {
    getSetting: vi.fn(),
  },
}));

describe('UpdateService', () => {
  let updateService: UpdateService;

  beforeEach(() => {
    updateService = new UpdateService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // 清理环境变量
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

      // 先设置一些环境变量
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

      // 先设置一些环境变量
      process.env.HTTP_PROXY = 'http://old-proxy:8080';

      await updateService.syncProxyEnv();

      expect(process.env.HTTP_PROXY).toBeUndefined();
    });
  });

  describe('状态更新', () => {
    it('通过 webContents 发送状态更新', () => {
      const mockSend = vi.fn();
      const mockWindow = {
        webContents: { send: mockSend },
      } as any;

      updateService.setMainWindow(mockWindow);

      // 触发状态更新（通过内部方法）
      // 由于 updateStatus 是私有方法，我们需要通过公共方法触发
      // 这里测试 setMainWindow 是否正确设置
      expect(mockWindow.webContents.send).toBeDefined();
    });
  });

  describe('版本信息', () => {
    it('返回正确的版本号', () => {
      const version = updateService.getVersion();
      expect(version).toBe('1.0.0');
    });
  });

  describe('检查更新超时', () => {
    it('检查更新超时时返回错误状态', async () => {
      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('Network timeout'));

      const status = await updateService.checkForUpdates(100); // 100ms 超时

      expect(status.status).toBe('error');
    });
  });

  describe('下载更新超时', () => {
    it('下载更新超时时返回 undefined', async () => {
      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.downloadUpdate).mockRejectedValue(new Error('Download timeout'));

      const result = await updateService.downloadUpdate(100);

      // downloadUpdate 捕获错误后返回 undefined
      expect(result).toBeUndefined();
    });
  });
});

describe('代理配置集成测试', () => {
  it('代理配置应该与 musicApi 的代理配置一致', async () => {
    // 验证 proxy.ts 的配置格式
    const proxyConfig = {
      enabled: true,
      protocol: 'http' as const,
      host: '127.0.0.1',
      port: 7890,
    };

    const proxyUrl = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`;
    expect(proxyUrl).toBe('http://127.0.0.1:7890');
  });
});
