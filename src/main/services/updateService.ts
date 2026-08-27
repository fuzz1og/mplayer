import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, session } from 'electron';
import {
  UPDATE_SOURCE_DEFS,
  probeUpdateSources,
  rankSourcesByLatency,
  toGenericFeedUrl,
  type UpdateSourceDef,
  type UpdateLatencyMap,
} from '@mplayer/core';
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

// 更新源清单与测速/排序逻辑在 @mplayer/core（#262，桌面/移动端共享单一事实源）：
// 静态兜底顺序 = 镜像在前、GitHub 直连垫底。

const CHANNEL_SETTING_KEY = 'updateChannel';
/** 通道设置项的合法取值：'auto' 或某个源 id */
type ChannelValue = string;
const PROBE_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 下载看门狗窗口（真机联调教训：原实现是一刀切 120s 硬超时，
 * 大文件慢速健康下载会被误杀——镜像对 latest.yml 快不代表大文件吞吐好）。
 * - 首字节窗口：起播后这么久没有任何进度 → 判定源不可用，快速降级换源
 * - 停滞窗口：进度开始后，两次进度事件间隔超过它 → 判定停滞
 * 只要进度持续推进就永不限时。
 */
const DOWNLOAD_FIRST_BYTE_MS = 25000;
const DOWNLOAD_STALL_MS = 30000;

export class UpdateService {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private checkListeners: Array<() => void> = [];
  private downloadListeners: Array<() => void> = [];
  private isChecking = false;
  private isDownloading = false;

  /** 本次检查/下载生效的尝试顺序（downloadUpdate 复用，默认静态兜底顺序） */
  private attemptOrder: readonly UpdateSourceDef[] = UPDATE_SOURCE_DEFS;
  /** 当前正在使用的源（透出到状态事件） */
  private activeSource: UpdateSourceDef | null = null;

  /** probe 结果缓存：id → 延迟 ms / null（失败） */
  private probeResults: UpdateLatencyMap = new Map();
  private probedAt = 0;

  /** 通道设置缓存（读穿透 db） */
  private channelCache: ChannelValue | null = null;

  private readonly autoProbeOnCheck: boolean;
  private readonly firstByteTimeoutMs: number;
  private readonly stallTimeoutMs: number;

  constructor(options?: {
    autoProbeOnCheck?: boolean;
    /** 测试可注入缩短看门狗窗口 */
    firstByteTimeoutMs?: number;
    stallTimeoutMs?: number;
  }) {
    this.autoProbeOnCheck = options?.autoProbeOnCheck ?? true;
    this.firstByteTimeoutMs = options?.firstByteTimeoutMs ?? DOWNLOAD_FIRST_BYTE_MS;
    this.stallTimeoutMs = options?.stallTimeoutMs ?? DOWNLOAD_STALL_MS;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.forceDevUpdateConfig = true;
  }

  /**
   * netSession 版 fetch 适配：走 electron-updater 专用会话，
   * 自动享受该会话的代理配置，与实际下载链路同环境。
   * 会话不可用 / 无 fetch 时返回 null（探针整体回落静态顺序）。
   */
  private sessionFetch(): ((url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>) | null {
    const netSession = autoUpdater.netSession;
    if (!netSession || typeof (netSession as unknown as { fetch?: unknown }).fetch !== 'function') return null;
    return (url, init) => (netSession as unknown as { fetch: (u: string, i?: object) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> }).fetch(url, init);
  }

  /** 切换 electron-updater 的 feed 到指定更新源 */
  private applyFeed(def: UpdateSourceDef) {
    this.activeSource = def;
    const genericUrl = toGenericFeedUrl(def);
    if (genericUrl === '') {
      autoUpdater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO });
    } else {
      autoUpdater.setFeedURL({ provider: 'generic', url: genericUrl });
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
    return UPDATE_SOURCE_DEFS.map(({ id, label }) => ({ id, label }));
  }

  /** 当前通道（缓存读穿透 db）；未配置或非法值视为 auto */
  async getChannel(): Promise<ChannelValue> {
    if (this.channelCache !== null) return this.channelCache;
    const saved = await db.getSetting<string>(CHANNEL_SETTING_KEY);
    if (saved !== undefined && (saved === 'auto' || UPDATE_SOURCE_DEFS.some(s => s.id === saved))) {
      this.channelCache = saved;
    }
    return this.channelCache ?? 'auto';
  }

  /** 设置并持久化通道；非法值抛错拒绝 */
  async setChannel(value: string): Promise<void> {
    if (value !== 'auto' && !UPDATE_SOURCE_DEFS.some(s => s.id === value)) {
      throw new Error(`非法更新通道: ${value}`);
    }
    await db.setSetting(CHANNEL_SETTING_KEY, value);
    this.channelCache = value;
  }

  /**
   * 并发探测全部源并按延迟升序返回（失败 null 垫底）。
   * 结果同时写入进程内缓存供检查流程复用。
   */
  async speedTest(timeoutMs?: number): Promise<Array<{ id: string; label: string; latencyMs: number | null }>> {
    const results = await this.probeAll(timeoutMs);
    const ranked = rankSourcesByLatency(UPDATE_SOURCE_DEFS, results);
    return ranked.map(def => ({ id: def.id, label: def.label, latencyMs: results.get(def.id) ?? null }));
  }

  private async probeAll(timeoutMs?: number): Promise<UpdateLatencyMap> {
    const fetchLike = this.sessionFetch();
    if (!fetchLike) return new Map();
    const results = await probeUpdateSources(fetchLike, timeoutMs !== undefined ? { timeoutMs } : {});
    this.probeResults = results;
    this.probedAt = Date.now();
    return results;
  }

  /** 缓存有效期内的探测快照；过期则重测（整体不可用则回落静态顺序） */
  private async ensureFreshProbes(): Promise<UpdateLatencyMap | null> {
    if (this.probedAt > 0 && Date.now() - this.probedAt < PROBE_CACHE_TTL_MS) {
      return this.probeResults;
    }
    try {
      const results = await this.probeAll();
      // 至少一个源探活成功才信任排序
      if ([...results.values()].some(v => v != null)) return results;
      console.warn('[update] 全部源测速失败，使用默认通道顺序');
      return null;
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
  private async resolveAttemptOrder(): Promise<readonly UpdateSourceDef[]> {
    const channel = await this.getChannel();
    if (channel !== 'auto') {
      const chosen = UPDATE_SOURCE_DEFS.find(s => s.id === channel)!;
      return [chosen, ...UPDATE_SOURCE_DEFS.filter(s => s.id !== channel)];
    }
    if (this.autoProbeOnCheck) {
      const probes = await this.ensureFreshProbes();
      if (probes) return rankSourcesByLatency(UPDATE_SOURCE_DEFS, probes);
    }
    return UPDATE_SOURCE_DEFS;
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

  /** 用当前 feed 执行一次下载（进度看门狗代替固定超时，见 DOWNLOAD_* 常量注释） */
  private downloadWithCurrentFeed(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let watchdog = setTimeout(
        () => reject(new Error(`下载停滞（${this.firstByteTimeoutMs}ms 无响应）`)),
        this.firstByteTimeoutMs,
      );
      const bumpWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(
          () => reject(new Error(`下载停滞（${this.stallTimeoutMs}ms 无进度）`)),
          this.stallTimeoutMs,
        );
      };

      const onDownloaded = () => {
        clearTimeout(watchdog);
        this.updateStatus({ status: 'downloaded' });
        resolve();
      };
      const onError = (err: Error) => {
        clearTimeout(watchdog);
        reject(err);
      };
      const onProgress = (progress: any) => {
        bumpWatchdog();
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
        clearTimeout(watchdog);
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        autoUpdater.removeListener('error', onError);
        autoUpdater.removeListener('download-progress', onProgress);
      });

      autoUpdater.downloadUpdate().catch((err: any) => {
        clearTimeout(watchdog);
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

  async downloadUpdate(): Promise<void> {
    if (this.isDownloading) return;
    this.isDownloading = true;

    this.cleanupDownloadListeners();

    let lastErr: Error | null = null;
    try {
      // 从检查时的生效顺序继续下载；失败依次降级。
      // 同源（检查时已拿到元数据）不重复 check；切源后才重新 check 拿元数据。
      // 超时语义由进度看门狗接管（首字节/停滞窗口），不再有一刀切总时长。
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
          await this.downloadWithCurrentFeed();
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
