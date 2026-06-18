import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import { db } from '../storage/db';
import type { ProxyConfig } from '../proxy';

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
  error?: string;
}

export class UpdateService {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private checkListeners: Array<() => void> = [];
  private downloadListeners: Array<() => void> = [];

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  // 从 DB 读代理，设到 process.env，供 @electron/get 使用
  async syncProxyEnv() {
    try {
      const config = await db.getSetting<ProxyConfig>('proxyConfig');
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
      // ignore proxy sync errors
    }
  }

  private updateStatus(status: UpdateStatus) {
    this.status = status;
    this.mainWindow?.webContents.send('update:status', status);
  }

  // 清理事件监听器
  private cleanupCheckListeners() {
    this.checkListeners.forEach(cleanup => cleanup());
    this.checkListeners = [];
  }

  private cleanupDownloadListeners() {
    this.downloadListeners.forEach(cleanup => cleanup());
    this.downloadListeners = [];
  }

  async checkForUpdates(timeoutMs = 10000): Promise<UpdateStatus> {
    // 清理之前的监听器
    this.cleanupCheckListeners();

    // 确保代理设置已同步
    await this.syncProxyEnv();

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('检查更新超时，请检查网络连接'));
        }, timeoutMs);

        const onAvailable = () => { clearTimeout(timer); resolve(); };
        const onNotAvailable = () => { clearTimeout(timer); resolve(); };
        const onError = (err: Error) => { clearTimeout(timer); reject(err); };

        autoUpdater.once('update-available', onAvailable);
        autoUpdater.once('update-not-available', onNotAvailable);
        autoUpdater.once('error', onError);

        // 保存清理函数
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
    } catch (err: any) {
      this.updateStatus({ status: 'error', error: err.message });
    } finally {
      // 清理监听器
      this.cleanupCheckListeners();
    }

    return this.status;
  }

  async downloadUpdate(timeoutMs = 120000): Promise<void> {
    // 清理之前的监听器
    this.cleanupDownloadListeners();

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('下载超时')), timeoutMs);

        const onDownloaded = () => { clearTimeout(timer); resolve(); };
        const onError = (err: Error) => { clearTimeout(timer); reject(err); };

        autoUpdater.once('update-downloaded', onDownloaded);
        autoUpdater.once('error', onError);

        // 保存清理函数
        this.downloadListeners.push(() => {
          autoUpdater.removeListener('update-downloaded', onDownloaded);
          autoUpdater.removeListener('error', onError);
        });

        autoUpdater.downloadUpdate().catch((err: any) => { clearTimeout(timer); reject(err); });
      });
    } catch (err: any) {
      this.updateStatus({ status: 'error', error: err.message });
    } finally {
      // 清理监听器
      this.cleanupDownloadListeners();
    }
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  getVersion(): string {
    return app.getVersion();
  }
}

export const updateService = new UpdateService();
