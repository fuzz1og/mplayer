import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, session } from 'electron';
import { db } from '../storage/db';
import type { ProxyConfig } from '../proxy';

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
  error?: string;
}

// GitHub 仓库信息（与 electron-builder.yml publish 配置一致）
const GITHUB_OWNER = 'fuzz1og';
const GITHUB_REPO = 'mplayer';

// 更新源列表（索引 0 = GitHub 直连，其后为镜像，按实测速度降级）。
// 镜像统一走 GitHub releases/latest/download 固定 URL（302 到最新 release），跨版本有效，
// 让 generic provider 能以固定地址拿到元数据与安装包。
const UPDATE_SOURCES: string[] = [
  '', // GitHub 直连（线路好时最快）
  'https://gh-proxy.com/https://github.com/fuzz1og/mplayer/releases/latest/download/',
  'https://ghfast.top/https://github.com/fuzz1og/mplayer/releases/latest/download/',
  'https://ghproxy.net/https://github.com/fuzz1og/mplayer/releases/latest/download/',
];

export class UpdateService {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private checkListeners: Array<() => void> = [];
  private downloadListeners: Array<() => void> = [];
  private isChecking = false;
  private isDownloading = false;
  /** 当前生效的更新源索引（检查/下载失败时递增降级） */
  private sourceIndex = 0;

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.forceDevUpdateConfig = true;
  }

  /** 切换 electron-updater 的 feed 到指定更新源 */
  private applyFeed(index: number) {
    if (index === 0) {
      autoUpdater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO });
    } else {
      autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_SOURCES[index] });
    }
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async syncProxyEnv() {
    try {
      const config = await db.getSetting<ProxyConfig>('proxyConfig');

      const netSession = autoUpdater.netSession;
      if (netSession) {
        if (config?.enabled && config.host) {
          const proxyRules = `http=${config.host}:${config.port};https=${config.host}:${config.port}`;
          await netSession.setProxy({ proxyRules });
        } else {
          await netSession.setProxy({ proxyRules: 'direct://' });
        }
      }

      if (config?.enabled && config.host) {
        const proxyRules = `${config.protocol}=${config.host}:${config.port}`;
        await session.defaultSession.setProxy({ proxyRules });
      } else {
        await session.defaultSession.setProxy({ proxyRules: 'direct://' });
      }

      if (config?.enabled && config.host) {
        const proxyUrl = `${config.protocol}://${config.host}:${config.port}`;
        process.env.HTTP_PROXY = proxyUrl;
        process.env.HTTPS_PROXY = proxyUrl;
        process.env.http_proxy = proxyUrl;
        process.env.https_proxy = proxyUrl;
        process.env.ELECTRON_GET_USE_PROXY = '1';
      } else {
        delete process.env.HTTP_PROXY;
        delete process.env.HTTPS_PROXY;
        delete process.env.http_proxy;
        delete process.env.https_proxy;
        delete process.env.ELECTRON_GET_USE_PROXY;
      }
    } catch (err) {
      console.error('同步代理设置失败:', err);
    }
  }

  private updateStatus(status: UpdateStatus) {
    this.status = status;
    this.mainWindow?.webContents.send('update:status', status);
  }

  private cleanupCheckListeners() {
    this.checkListeners.forEach(cleanup => cleanup());
    this.checkListeners = [];
  }

  private cleanupDownloadListeners() {
    this.downloadListeners.forEach(cleanup => cleanup());
    this.downloadListeners = [];
  }

  /** 用当前 feed 执行一次检查（事件监听 + checkForUpdates） */
  private checkWithCurrentFeed(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('检查更新超时，请检查网络连接'));
      }, timeoutMs);

      const onAvailable = (info: any) => {
        clearTimeout(timer);
        this.updateStatus({ status: 'available', version: info.version, releaseNotes: info.releaseNotes });
        resolve();
      };
      const onNotAvailable = () => {
        clearTimeout(timer);
        this.updateStatus({ status: 'not-available' });
        resolve();
      };
      const onError = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      autoUpdater.once('update-available', onAvailable);
      autoUpdater.once('update-not-available', onNotAvailable);
      autoUpdater.once('error', onError);
      this.checkListeners.push(() => {
        autoUpdater.removeListener('update-available', onAvailable);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('error', onError);
      });

      autoUpdater.checkForUpdates().catch((err: any) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** 用当前 feed 执行一次下载 */
  private downloadWithCurrentFeed(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('下载超时')), timeoutMs);

      const onDownloaded = () => {
        clearTimeout(timer);
        this.updateStatus({ status: 'downloaded' });
        resolve();
      };
      const onError = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      const onProgress = (progress: any) => {
        this.updateStatus({ status: 'downloading', progress });
      };

      autoUpdater.once('update-downloaded', onDownloaded);
      autoUpdater.once('error', onError);
      autoUpdater.on('download-progress', onProgress);
      this.downloadListeners.push(() => {
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        autoUpdater.removeListener('error', onError);
        autoUpdater.removeListener('download-progress', onProgress);
      });

      autoUpdater.downloadUpdate().catch((err: any) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async checkForUpdates(timeoutMs = 10000): Promise<UpdateStatus> {
    if (this.isChecking) return this.status;
    this.isChecking = true;
    this.updateStatus({ status: 'checking' });

    this.cleanupCheckListeners();
    await this.syncProxyEnv();

    let lastErr: Error | null = null;
    try {
      // 从上次生效源开始依次尝试；失败降级到下一源（直连 → gh-proxy.com → ghfast.top → ghproxy.net）
      for (let i = this.sourceIndex; i < UPDATE_SOURCES.length; i++) {
        this.sourceIndex = i;
        this.applyFeed(i);
        try {
          await this.checkWithCurrentFeed(timeoutMs);
          return this.status;
        } catch (err: any) {
          lastErr = err;
          console.warn(`[update] 更新源 #${i} 检查失败（${UPDATE_SOURCES[i] || 'GitHub 直连'}），降级：${err.message}`);
        }
      }
      throw lastErr ?? new Error('所有更新源均不可用');
    } catch (err: any) {
      this.updateStatus({ status: 'error', error: err.message });
      throw err;
    } finally {
      this.cleanupCheckListeners();
      this.isChecking = false;
    }
  }

  async downloadUpdate(timeoutMs = 120000): Promise<void> {
    if (this.isDownloading) return;
    this.isDownloading = true;

    this.cleanupDownloadListeners();

    let lastErr: Error | null = null;
    try {
      // 从检查时的生效源开始下载；失败依次降级。
      // 同源（检查时已拿到元数据）不重复 check；切源后才重新 check 拿元数据。
      const firstSource = this.sourceIndex;
      for (let i = firstSource; i < UPDATE_SOURCES.length; i++) {
        if (i !== firstSource) {
          this.sourceIndex = i;
          this.applyFeed(i);
          try {
            await this.checkWithCurrentFeed(15000);
          } catch (err: any) {
            if (!lastErr) lastErr = err;
            console.warn(`[update] 更新源 #${i} 检查失败（${UPDATE_SOURCES[i]}），降级：${err.message}`);
            continue;
          }
          if (this.status.status !== 'available') {
            this.updateStatus({ status: 'idle' });
            return;
          }
        }
        try {
          await this.downloadWithCurrentFeed(timeoutMs);
          return;
        } catch (err: any) {
          lastErr = err;
          console.warn(`[update] 更新源 #${i} 下载失败（${UPDATE_SOURCES[i] || 'GitHub 直连'}），降级：${err.message}`);
        }
      }
      throw lastErr ?? new Error('所有更新源下载均失败');
    } catch (err: any) {
      this.updateStatus({ status: 'error', error: err.message });
      throw err;
    } finally {
      this.cleanupDownloadListeners();
      this.isDownloading = false;
    }
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }

  getVersion(): string {
    return app.getVersion();
  }
}

export const updateService = new UpdateService();
