import { requireOptionalNativeModule } from 'expo';

/**
 * MPlayer 原生播放器桥（仅 Android）。
 *
 * iOS/Web 上没有这个模块 → 必须用 `requireOptionalNativeModule`（决策 #11：
 * `expo-module.config.json` 只声明 android，iOS 回落 expo-audio 老路径）。
 *
 * 设计口径（规格 §2.3/§4.3）：**权威队列在原生**；事件是「通知」性质，
 * JS 回前台用 `getState()` 单向对账，禁止双向写。
 */

export type TrackMeta = {
  /** core identityKey：原生侧主键与去重键 */
  key: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationMs?: number;
  /** 试听标记（ADR-0012）随事件回传，JS 写 audioTagStore */
  nonFull?: boolean;
  sourceType?: string;
};

export type Track = {
  /** core Song.id —— 事件回传后 JS 反查 Song 的唯一依据 */
  songId: string;
  /** 已解析直链（http/https/file） */
  url: string;
  /** 绝对过期时间（I4）；0 = 不适用/未知 */
  expiresAtEpochMs: number;
  headers?: Record<string, string>;
  meta: TrackMeta;
};

export type Policy = {
  /** settingsStore.autoSkipOnError */
  autoSkip: boolean;
  /** core SKIP_LIMIT */
  skipLimit: number;
  /** core 离线即停 */
  stopWhenOffline: boolean;
  /** 窗口 N */
  prefetchAhead: number;
};

export type LoopMode = 'off' | 'all' | 'single';

/**
 * `patchQueue` 的回执。
 *
 * `stale` = baseRevision 落后（本轮丢弃，调用方重读 revision 后重试）；
 * `error` 只在「下一首播放」（#494）路径上出现：media3 的命令级失败过去是**静默丢弃**的，
 * 这里把它变成调用方能看见、能提示用户的原因（`unsupported` / `failed`）。
 */
export type PatchQueueResult = {
  accepted: boolean;
  revision: number;
  stale: boolean;
  /** 队列是否真的变了（幂等命中 = false） */
  changed?: boolean;
  /** 之前已在原生队列里（无论新移入还是本来就在 index+1） */
  queued?: boolean;
  /** 本次是从别处移动过来（false = 新插入，或幂等命中没动） */
  moved?: boolean;
  error?: 'unsupported' | 'failed';
};

/** 原生队列里的一项（冷启对账用；不含 url —— 那是原生的私有状态） */
export type NativeTrackInfo = {
  key: string;
  songId: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  artworkUrl?: string | null;
  durationMs?: number;
  nonFull?: boolean;
  sourceType?: string | null;
};

export type PlayerState = {
  revision: number;
  /** 原生权威队列快照（§4.3：JS 冷启/回前台据此重建 playerStore.queue） */
  tracks?: NativeTrackInfo[];
  index: number;
  playing: boolean;
  playWhenReady: boolean;
  positionMs: number;
  durationMs: number;
  bufferedAheadMs: number;
  loopMode: LoopMode;
  rate: number;
  key?: string | null;
  songId?: string | null;
  queueSize: number;
  aheadCount: number;
  restoring: boolean;
  foreground: boolean;
  serviceRunning?: boolean;
  skippedThisSession: number;
};

export type ChangeReason = 'auto' | 'user' | 'errorSkip' | 'restore';
export type EndReason = 'exhausted' | 'windowHole' | 'stopped';
export type NeedReason = 'lowWater' | 'hole';
export type ErrorDisposition = 'retrying' | 'skipped' | 'stopped';

export type TrackChangedEvent = {
  fromKey?: string | null;
  toKey: string;
  songId?: string | null;
  index: number;
  reason: ChangeReason;
  revision: number;
};

export type StateChangedEvent = {
  revision: number;
  index: number;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  bufferedAheadMs: number;
  loopMode: LoopMode;
  rate: number;
};

export type ProgressEvent = {
  revision: number;
  index: number;
  positionMs: number;
  durationMs: number;
};

export type QueueEndedEvent = { reason: EndReason; index: number; revision: number };

export type NeedTracksEvent = {
  currentIndex: number;
  remaining: number;
  reason: NeedReason;
  revision: number;
};

export type PlaybackErrorEvent = {
  key: string;
  songId?: string | null;
  code: string;
  httpStatus?: number | null;
  message: string;
  disposition: ErrorDisposition;
  revision: number;
  index: number;
};

export type ServiceStateEvent = { foreground: boolean; restoring: boolean };

export type NativePlayerEvents = {
  trackChanged: TrackChangedEvent;
  stateChanged: StateChangedEvent;
  progress: ProgressEvent;
  queueEnded: QueueEndedEvent;
  needTracks: NeedTracksEvent;
  playbackError: PlaybackErrorEvent;
  serviceState: ServiceStateEvent;
};

type Subscription = { remove(): void };

export type NativePlayerModule = {
  /** JS 模块加载时调用一次：把 HeadlessJsTaskContext 寄存到原生；返回通道是否可用 */
  registerHeadlessHost(): boolean;
  isServiceRunning(): boolean;
  getState(): PlayerState;
  loadQueue(input: {
    revision: number;
    tracks: Track[];
    startIndex: number;
    playWhenReady: boolean;
    loopMode: LoopMode;
    policy: Policy;
  }): Promise<{ accepted: boolean; state: PlayerState }>;
  patchQueue(input: {
    baseRevision: number;
    append?: Track[];
    upsert?: Track[];
    removeKeys?: string[];
    /**
     * 「下一首播放」（#494）：把这一首放到**当前曲之后**（已在队列则移动、不在则插入）。
     * 单独一条语义路径；`error` 非空 = 可观测失败（`unsupported` / `failed`），绝不静默丢弃。
     */
    insertAfterCurrent?: Track;
    /**
     * #563：HOLE 补窗一轮**零候选**时的显式回执。原生据此给待决的「用户下一首」
     * 一个确定结局（绕回窗口里已有的项 / 诚实结束），不让意图悬空、不让水位 tick 空转。
     */
    refillEmpty?: boolean;
  }): Promise<PatchQueueResult>;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  setLoop(mode: LoopMode): void;
  setRate(rate: number): void;
  setPolicy(policy: Policy): void;
  stop(): void;
  addListener<K extends keyof NativePlayerEvents>(
    event: K,
    listener: (payload: NativePlayerEvents[K]) => void
  ): Subscription;
};

export const NativePlayer =
  requireOptionalNativeModule<NativePlayerModule>('MPlayerNativePlayer');

/** 原生播放器是否可用（Android 真机/模拟器上有；iOS/Web 上为 false）。 */
export const isNativePlayerAvailable = NativePlayer != null;

/** 头less 任务 key：必须与原生 `PrefetchBridge.TASK_KEY` 一致。 */
export const PREFETCH_TASK_KEY = 'MPlayerPrefetch';

export const DEFAULT_POLICY: Policy = {
  autoSkip: true,
  skipLimit: 3,
  stopWhenOffline: false,
  prefetchAhead: 3,
};
