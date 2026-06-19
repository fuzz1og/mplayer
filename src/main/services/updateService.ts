import { autoUpdater, UpdateInfo } from 'electron-updater';
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

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ status: 'checking' });
    });
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateStatus({
        status: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });
    });
    autoUpdater.on('update-not-available', () => {
      this.updateStatus({ status: 'not-available' });
    });
    autoUpdater.on('download-progress', (progress: any) => {
      this.updateStatus({
        status: 'downloading',
        progress: {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        },
      });
    });
    autoUpdater.on('update-downloaded', () => {
      this.updateStatus({ status: 'downloaded' });
    });
    autoUpdater.on('error', (err: Error) => {
      this.updateStatus({ status: 'error', error: err.message });
    });
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

  async checkForUpdates(timeoutMs = 10000): Promise<UpdateStatus> {
    await this.syncProxyEnv();

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('检查更新超时，请检查网络连接'));
        }, timeoutMs);

        autoUpdater.once('update-available', () => { clearTimeout(timer); resolve(); });
        autoUpdater.once('update-not-available', () => { clearTimeout(timer); resolve(); });
        autoUpdater.once('error', (err: Error) => { clearTimeout(timer); reject(err); });

        autoUpdater.checkForUpdates().catch((err: any) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    } catch (err: any) {
      this.updateStatus({ status: 'error', error: err.message });
    }

    return this.status;
  }

  async downloadUpdate(timeoutMs = 120000): Promise<void> {
    await this.syncProxyEnv();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('下载超时')), timeoutMs);
        autoUpdater.once('update-downloaded', () => { clearTimeout(timer); resolve(); });
        autoUpdater.once('error', (err: Error) => { clearTimeout(timer); reject(err); });
        autoUpdater.downloadUpdate().catch((err: any) => { clearTimeout(timer); reject(err); });
      });
    } catch (err: any) {
      this.updateStatus({ status: 'error', error: err.message });
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
