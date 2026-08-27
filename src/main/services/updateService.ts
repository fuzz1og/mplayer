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
  /** 本状态对应的更新源展示名（仅 available / downloading 透出，UI 显示当前通道） */
  sourceLabel?: string;
}

// GitHub 仓库信息（与 electron-builder.yml publish 配置一致）
const GITHUB_OWNER = 'fuzz1og';
const GITHUB_REPO = 'mplayer';

// releases/latest/download 固定 URL（302 到最新 release），跨版本有效，
// generic provider 以固定地址拿元数据与安装包；也是测速探针的目标（体积极小）。
const GITHUB_LATEST_BASE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/`;

/** 单个更新源定义。baseUrl 为空串表示 GitHub 直连（github provider），其余为镜像前缀。 */
export interface SourceDef {
  id: string;
  /** UI 展示名 */
  label: string;
  baseUrl: string;
}

// 静态兜底顺序（#262）：镜像在前、GitHub 直连垫底。国内直连线路不稳定，
// 只有全部镜像失败时才落到直连；probe 排序与手动选道都基于该基准列表。
const UPDATE_SOURCES: SourceDef[] = [
  { id: 'gh-proxy', label: 'gh-proxy.com 镜像', baseUrl: 'https://gh-proxy.com/' + GITHUB_LATEST_BASE },
  { id: 'ghfast', label: 'ghfast.top 镜像', baseUrl: 'https://ghfast.top/' + GITHUB_LATEST_BASE },
  { id: 'ghproxynet', label: 'ghproxy.net 镜像', baseUrl: 'https://ghproxy.net/' + GITHUB_LATEST_BASE },
  { id: 'github', label: 'GitHub 直连', baseUrl: '' },
];

/** 通道设置项的合法取值：'auto' 或某个源 id */
type ChannelValue = 'auto' | string;
const CHANNEL_SETTING_KEY = 'updateChannel';
const PROBE_CACHE_TTL_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 5000;

export class UpdateService {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private checkListeners: Array<() => void> = [];
  private downloadListeners: Array<() => void> = [];
  private isChecking = false;
  private isDownloading = false;

  /** 本次检查/下载生效的尝试顺序（downloadUpdate 复用，默认静态兜底顺序） */
  private attemptOrder: SourceDef[] = UPDATE_SOURCES;
  /** 当前正在使用的源（透出到状态事件） */
  private activeSource: SourceDef | null = null;

  /** probe 结果缓存：id → 延迟 ms / null（失败） */
  private probeResults: Map<string, number | null> = new Map();
  private probedAt = 0;

  /** 通道设置缓存（读穿透 db） */
  private channelCache: ChannelValue | null = null;

  private readonly autoProbeOnCheck: boolean;

  constructor(options?: { autoProbeOnCheck?: boolean }) {
    this.autoProbeOnCheck = options?.autoProbeOnCheck ?? true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.forceDevUpdateConfig = true;
  }

  /** 切换 electron-updater 的 feed 到指定更新源 */
  private applyFeed(def: SourceDef) {
    this.activeSource = def;
    if (def.baseUrl === '') {
      autoUpdater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO });
    } else {
      autoUpdater.setFeedURL({ provider: 'generic', url: def.baseUrl });
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

      // 审查修复：移除 process.env.HTTP(S)_PROXY 全局注入——污染主进程所有网络请求，
      // 与 axios agents 双轨代理易不一致。代理仅通过 session 级 setProxy 生效：
      // electron-updater 专用 netSession + 应用 defaultSession（defaultSession 由
      // main.ts applyElectronProxy 统一维护，此处为更新检查触发时的二次同步）。
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

  // ── 通道选择与测速（#262）───────────────────────────────────────────

  /** 对外展示用源清单（静态兜底顺序） */
  listSources(): Array<{ id: string; label: string }> {
    return UPDATE_SOURCES.map(({ id, label }) => ({ id, label }));
  }

  /** 当前通道（缓存读穿透 db）；未配置或非法值视为 auto */
  async getChannel(): Promise<ChannelValue> {
    if (this.channelCache !== null) return this.channelCache;
    const saved = await db.getSetting<string>(CHANNEL_SETTING_KEY);
    if (saved !== undefined && (saved === 'auto' || UPDATE_SOURCES.some(s => s.id === saved))) {
      this.channelCache = saved;
    }
    return this.channelCache ?? 'auto';
  }

  /** 设置并持久化通道；非法值抛错拒绝 */
  async setChannel(value: string): Promise<void> {
    if (value !== 'auto' && !UPDATE_SOURCES.some(s => s.id === value)) {
      throw new Error(`非法更新通道: ${value}`);
    }
    await db.setSetting(CHANNEL_SETTING_KEY, value);
    this.channelCache = value;
  }

  /**
   * 并发探测全部源：GET latest.yml（体积极小、带 Range 截断），返回按延迟升序的结果。
   * 走 autoUpdater.netSession，自动享受该会话的代理配置，与实际下载链路同环境。
   */
  async speedTest(timeoutMs = PROBE_TIMEOUT_MS): Promise<Array<{ id: string; label: string; latencyMs: number | null }>> {
    const results = await this.probeAll(timeoutMs);
    const ranked = this.rankByLatency(UPDATE_SOURCES, results);
    return ranked.map(def => ({ id: def.id, label: def.label, latencyMs: results.get(def.id) ?? null }));
  }

  private async probeAll(timeoutMs: number): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    await Promise.all(
      UPDATE_SOURCES.map(async def => {
        results.set(def.id, await this.probeOne(def, timeoutMs));
      }),
    );
    this.probeResults = results;
    this.probedAt = Date.now();
    return results;
  }

  private async probeOne(def: SourceDef, timeoutMs: number): Promise<number | null> {
    const netSession = autoUpdater.netSession;
    if (!netSession || typeof (netSession as any).fetch !== 'function') return null;
    const url = `${def.baseUrl}latest.yml`;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await (netSession as any).fetch(url, {
        signal: controller.signal,
        headers: { Range: 'bytes=0-4095' },
      });
      await res.arrayBuffer();
      return Date.now() - startedAt;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 稳定排序：成功探针按延迟升序，失败(null)垫底；并列保持静态兜底相对顺序 */
  private rankByLatency(defs: SourceDef[], latencies: Map<string, number | null>): SourceDef[] {
    return [...defs].sort((a, b) => (latencies.get(a.id) ?? Infinity) - (latencies.get(b.id) ?? Infinity));
  }

  /** 缓存有效期内的探测快照；过期则重测（失败不致命，回落静态顺序） */
  private async ensureFreshProbes(): Promise<Map<string, number | null> | null> {
    if (this.probedAt > 0 && Date.now() - this.probedAt < PROBE_CACHE_TTL_MS) {
      return this.probeResults;
    }
    try {
      return await this.probeAll(PROBE_TIMEOUT_MS);
    } catch (err) {
      console.warn(`[update] 测速失败，使用默认通道顺序：${(err as Error).message}`);
      return null;
    }
  }

  /**
   * 计算本轮检查/下载的尝试顺序：
   * - 手动通道：选中源置顶，其余保持静态兜底顺序（仍可逐源降级）
   * - auto：优先测速快照排序；无可用探针结果时回落静态兜底顺序
   */
  private async resolveAttemptOrder(): Promise<SourceDef[]> {
    const channel = await this.getChannel();
    if (channel !== 'auto') {
      const chosen = UPDATE_SOURCES.find(s => s.id === channel)!;
      return [chosen, ...UPDATE_SOURCES.filter(s => s.id !== channel)];
    }
    if (this.autoProbeOnCheck) {
      const probes = await this.ensureFreshProbes();
      if (probes) {
        // 至少有一个源探活成功才信任排序；全失败由 rankByLatency 保持静态顺序
        if ([...probes.values()].some(v => v != null)) {
          return this.rankByLatency(UPDATE_SOURCES, probes);
        }
        console.warn('[update] 全部源测速失败，使用默认通道顺序');
      }
    }
    return UPDATE_SOURCES;
  }

  // ── 检查与下载 ─────────────────────────────────────────────────────

  /** 用当前 feed 执行一次检查（事件监听 + checkForUpdates） */
  private checkWithCurrentFeed(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('检查更新超时，请检查网络连接'));
      }, timeoutMs);

      const onAvailable = (info: any) => {
        clearTimeout(timer);
        this.updateStatus({
          status: 'available',
          version: info.version,
          releaseNotes: info.releaseNotes,
          ...(this.activeSource ? { sourceLabel: this.activeSource.label } : {}),
        });
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
        this.updateStatus({
          status: 'downloading',
          progress,
          ...(this.activeSource ? { sourceLabel: this.activeSource.label } : {}),
        });
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
      // 镜像优先、GitHub 直连兜底（#262）：auto 模式先测速再排序；
      // 手动模式把所选通道排最前。失败时沿顺序逐源降级。
      this.attemptOrder = await this.resolveAttemptOrder();
      for (let i = 0; i < this.attemptOrder.length; i++) {
        const def = this.attemptOrder[i];
        this.applyFeed(def);
        try {
          await this.checkWithCurrentFeed(timeoutMs);
          return this.status;
        } catch (err: any) {
          lastErr = err;
          console.warn(`[update] 更新源「${def.label}」检查失败，降级：${err.message}`);
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
      // 从检查时的生效顺序继续下载；失败依次降级。
      // 同源（检查时已拿到元数据）不重复 check；切源后才重新 check 拿元数据。
      const order = this.attemptOrder;
      const firstSource = this.activeSource ?? order[0];
      const startIndex = Math.max(order.indexOf(firstSource), 0);
      for (let i = startIndex; i < order.length; i++) {
        const def = order[i];
        this.applyFeed(def);
        if (i !== startIndex) {
          try {
            await this.checkWithCurrentFeed(15000);
          } catch (err: any) {
            if (!lastErr) lastErr = err;
            console.warn(`[update] 更新源「${def.label}」检查失败，降级：${err.message}`);
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
          console.warn(`[update] 更新源「${def.label}」下载失败，降级：${err.message}`);
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
