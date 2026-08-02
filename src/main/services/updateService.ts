import axios from 'axios';
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

const GITEE_OWNER = 'aris3104';
const GITEE_REPO = 'mplayer';
const GITEE_RELEASES_URL = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases?per_page=100`;

interface GiteeReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GiteeRelease {
  tag_name?: string;
  created_at?: string;
  prerelease?: boolean;
  assets?: GiteeReleaseAsset[];
}

function normalizeVersionTag(tag: string): string {
  return tag.replace(/^[vV]/, '');
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^[vV]/, '').split('.').map(Number);
  const pb = b.replace(/^[vV]/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function pickGiteeDesktopRelease(releases: GiteeRelease[]): GiteeRelease | null {
  const desktop = (releases || []).filter(release =>
    release && !release.prerelease &&
    (release.assets || []).some(asset => /^latest(-(linux|mac))?\.yml$/.test(asset.name || ''))
  );
  if (desktop.length === 0) return null;
  return [...desktop].sort((a, b) => {
    const byVersion = compareVersions(
      normalizeVersionTag(b.tag_name || ''),
      normalizeVersionTag(a.tag_name || '')
    );
    if (byVersion !== 0) return byVersion;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  })[0] ?? null;
}

export function getGiteeDesktopFeedUrl(release: GiteeRelease | null): string | null {
  const asset = release?.assets?.find(a => /^latest(-(linux|mac))?\.yml$/.test(a.name || ''));
  if (!asset?.browser_download_url) return null;
  return asset.browser_download_url.replace(/\/[^/]+$/, '');
}

export class UpdateService {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private checkListeners: Array<() => void> = [];
  private downloadListeners: Array<() => void> = [];
  private isChecking = false;
  private isDownloading = false;
  private giteeFeedUrl: string | null = null;

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.forceDevUpdateConfig = true;
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  private async resolveGiteeFeedUrl(): Promise<string> {
    const response = await axios.get<GiteeRelease[]>(GITEE_RELEASES_URL, { timeout: 10000 });
    const release = pickGiteeDesktopRelease(response.data || []);
    const feedUrl = getGiteeDesktopFeedUrl(release);
    if (!feedUrl) throw new Error('Gitee 镜像仓库未找到桌面端更新文件');
    return feedUrl;
  }

  private async prepareGiteeFeed(): Promise<string> {
    const feedUrl = await this.resolveGiteeFeedUrl();
    this.giteeFeedUrl = feedUrl;
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    return feedUrl;
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

  async checkForUpdates(timeoutMs = 10000): Promise<UpdateStatus> {
    if (this.isChecking) return this.status;
    this.isChecking = true;
    this.updateStatus({ status: 'checking' });

    this.cleanupCheckListeners();
    await this.syncProxyEnv();

    try {
      await this.prepareGiteeFeed();

      await new Promise<void>((resolve, reject) => {
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
    } catch (err: any) {
      this.updateStatus({ status: 'error', error: err.message });
      throw err;
    } finally {
      this.cleanupCheckListeners();
      this.isChecking = false;
    }

    return this.status;
  }

  async downloadUpdate(timeoutMs = 120000): Promise<void> {
    if (this.isDownloading) return;
    this.isDownloading = true;

    this.cleanupDownloadListeners();

    try {
      if (!this.giteeFeedUrl) {
        await this.prepareGiteeFeed();
      }

      await new Promise<void>((resolve, reject) => {
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
