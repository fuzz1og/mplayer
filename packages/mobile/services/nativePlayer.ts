import { AppRegistry } from 'react-native';
import type { Song } from '@mplayer/core';
import {
  NativePlayer,
  isNativePlayerAvailable,
  PREFETCH_TASK_KEY,
  type ChangeReason,
  type ErrorDisposition,
  type LoopMode,
  type NativePlayerEvents,
  type NeedReason,
  type PatchOutcome,
  type PatchQueueResult,
  type PlaybackErrorEvent,
  type PlayerState,
  type Policy,
  type QueueEndedEvent,
  type Track,
} from '../modules/native-player';
import { usePlayerStore } from '../stores/playerStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLogsStore } from '../stores/logsStore';
import { getCachedResource, setCachedResource, urlAgeMs } from './cacheService';
import { resolvePlayableUrlMobile } from './songResolution';
import {
  PREFETCH_SKIP_FRESH_MS,
  beginResolve,
  endResolve,
  isCoolingDown,
  isInFlight,
  markFailed,
  markSucceeded,
  planNextIndexes,
  prefetchKey,
  PREFETCH_LEAD_SEC,
} from './queuePrefetch';

/**
 * 原生播放引擎（规格 §2.1/§4.3/§5）。
 *
 * 权威队列在原生；JS 只在活着时**预解析并喂窗口**。事件是通知性质的
 * （I1/I2），回前台用 `getState()` 单向对账，禁止双向写。
 *
 * 本文件不 import `audioPlayer.ts`（避免循环依赖）：需要引擎外的东西时走 hooks。
 */

/** 无过期信息的直链给一个保守上限（§6.1 / R8），避免「一路播到 403 才发现」 */
const EXPIRY_FALLBACK_MS = 30 * 60 * 1000;
/** core SKIP_LIMIT（packages/core/src/shared/skipGuard.ts） */
const SKIP_LIMIT = 3;

export type NativePlayerHooks = {
  onTrackChanged?: (song: Song | null, reason: ChangeReason) => void;
  onProgress?: (positionSec: number, durationSec: number) => void;
  onPlayingChanged?: (playing: boolean) => void;
  onQueueEnded?: (event: QueueEndedEvent) => void;
  onPlaybackError?: (event: PlaybackErrorEvent, song: Song | null) => void;
  /** 原生兜底判定该曲终局失败 → 交回 core skipGuard 的处置链路 */
  onTerminalFailure?: (song: Song, reason: string) => Promise<void>;
};

let hooks: NativePlayerHooks = {};
let started = false;
let headlessRegistered = false;

/** 原生列表的本地镜像（key/songId，顺序与原生一致）——用于补窗去重与随机定序 */
let nativeMirror: Array<{ key: string; songId: string }> = [];

export function isNativeEngine(): boolean {
  return isNativePlayerAvailable;
}

/** @deprecated 用 queuePrefetch 的 `prefetchKey`；保留此别名避免调用点漂移 */
export const songKey = prefetchKey;

/** 播放模式 → 原生 loopMode（随机由 JS 定序、原生只顺序推进，§7.3 建议方案） */
export function toLoopMode(playMode: string): LoopMode {
  if (playMode === '单曲循环') return 'single';
  if (playMode === '列表循环') return 'all';
  // 随机播放：JS 定序 + 原生顺序推进（'all' 让队列尾部能续上）
  return 'all';
}

export function currentPolicy(): Policy {
  const settings = useSettingsStore.getState();
  return {
    autoSkip: settings.autoSkipOnError,
    skipLimit: SKIP_LIMIT,
    // core skipGuard 的「离线即停」是硬语义（OFFLINE_COPY → pause，不进解析链）
    stopWhenOffline: true,
    prefetchAhead: 3,
  };
}

function headersFor(song: Song): Record<string, string> | undefined {
  if (song.sourceType === 'local') return undefined;
  return undefined;
}

function expiryFor(url: string): number {
  if (url.startsWith('file://')) return 0;
  return Date.now() + EXPIRY_FALLBACK_MS;
}

function buildTrack(song: Song, url: string, nonFull: boolean): Track {
  return {
    songId: song.id || songKey(song),
    url,
    expiresAtEpochMs: expiryFor(url),
    headers: headersFor(song),
    meta: {
      key: songKey(song),
      title: song.name,
      artist: song.artist,
      album: song.album,
      artworkUrl: song.cover,
      durationMs: song.duration ? Math.round(song.duration * 1000) : undefined,
      nonFull,
      sourceType: song.sourceType as string | undefined,
    },
  };
}

/** 解析一首歌的可播直链（缓存优先；`fresh` 绕过缓存重走整条 core 解析链） */
export async function resolveTrack(song: Song, fresh = false): Promise<Track | null> {
  if (song.sourceType === 'local' && song.url) {
    return buildTrack(song, song.url, false);
  }

  if (!fresh) {
    const cached = await getCachedResource(song);
    const age = urlAgeMs(song);
    if (cached?.url && age != null && age < PREFETCH_SKIP_FRESH_MS) {
      return buildTrack(song, cached.url, !!cached.nonFull);
    }
  }

  const resolved = await resolvePlayableUrlMobile(song);
  if (!resolved.url?.startsWith('http') && !resolved.url?.startsWith('file://')) return null;
  if (song.id) {
    void setCachedResource(song, { url: resolved.url, nonFull: resolved.nonFull, ts: Date.now() });
  }
  return buildTrack(song, resolved.url, resolved.nonFull);
}

// ── 事件订阅 ────────────────────────────────────────────────

export function initNativePlayer(next: NativePlayerHooks): void {
  hooks = next;
  if (started || !NativePlayer) return;
  started = true;

  // 冷启对账：服务可能已经按快照恢复了队列，先把 JS 队列补齐再挂监听。
  reconcileQueueFromNative(safeState());

  NativePlayer.addListener('trackChanged', (event) => {
    pruneMirror(event.toKey);
    // 原生可能刚裁剪过历史（长会话防膨胀）→ 用权威快照重建 mirror，
    // 否则 JS 的去重集会残留已不存在的 key，补窗时会漏投。
    syncMirrorFromNative();
    const song = findSong(event.songId, event.toKey);
    if (event.reason === 'errorSkip' && song) {
      hooks.onTrackChanged?.(song, 'errorSkip');
      return;
    }
    if (event.reason === 'restore') {
      hooks.onTrackChanged?.(song, 'restore');
      return;
    }
    hooks.onTrackChanged?.(song, event.reason);
    void feedWindow();
  });

  NativePlayer.addListener('stateChanged', (event) => {
    hooks.onPlayingChanged?.(event.playing);
    if (event.durationMs > 0) hooks.onProgress?.(event.positionMs / 1000, event.durationMs / 1000);
  });

  NativePlayer.addListener('progress', (event) => {
    hooks.onProgress?.(event.positionMs / 1000, event.durationMs / 1000);
    // 剩余 ≤ 15s 补一次窗口（§5.5）：不再是保命机制，只为降低踩空概率。
    // feedWindow 自身有在飞/新鲜/冷却三层去重，这里不需要额外节流。
    if (event.durationMs > 0 && (event.durationMs - event.positionMs) / 1000 <= PREFETCH_LEAD_SEC) {
      void feedWindow();
    }
  });

  NativePlayer.addListener('queueEnded', (event) => {
    hooks.onQueueEnded?.(event);
    // windowHole = 用户主动 next 踩空（原生已 pause 并要歌）→ 按 HOLE 补。
    // #591：第二个参数只是**诊断标签**（原 `NeedReason`），不再决定回执/结算走哪条；
    // 零候选是否会终结由原生按 `outcome: 'empty'` 判定。
    if (event.reason !== 'exhausted') {
      void feedWindow(undefined, event.reason === 'windowHole' ? 'hole' : undefined);
    }
  });

  NativePlayer.addListener('needTracks', (event) => {
    void feedWindow(undefined, event.reason);
  });

  NativePlayer.addListener('playbackError', (event) => {
    const song = findSong(event.songId, event.key);
    hooks.onPlaybackError?.(event, song);
    if (event.disposition === 'retrying') {
      void refreshFailedTrack(event);
    } else if (event.disposition === 'skipped' && song) {
      void hooks.onTerminalFailure?.(song, event.message);
    }
  });

  NativePlayer.addListener('serviceState', () => {
    // 诊断用途：仅记录，不驱动任何状态机
  });
}

function findSong(songId?: string | null, key?: string | null): Song | null {
  // 反查不到时（典型：进程重启后原生已恢复、JS 队列还空着）先对账一次再找
  if (usePlayerStore.getState().queue.length === 0) {
    reconcileQueueFromNative(safeState());
  }
  const queue = usePlayerStore.getState().queue;
  if (songId) {
    const byId = queue.find((s) => s.id === songId);
    if (byId) return byId;
  }
  if (key) {
    const byKey = queue.find((s) => songKey(s) === key);
    if (byKey) return byKey;
  }
  return null;
}

/** 原生推进到 toKey 之后，镜像里前面的条目不会再播 → 丢掉 */
function pruneMirror(toKey: string): void {
  const at = nativeMirror.findIndex((entry) => entry.key === toKey);
  nativeMirror = at >= 0 ? nativeMirror.slice(at) : nativeMirror.slice(-1);
}

/**
 * 用原生的权威队列重建 JS 的 playerStore（§4.3 的**单向对账**）。
 *
 * 为什么必须做：`playerStore` 不持久化，进程被系统杀掉后 JS 的 queue 是空的，
 * 而原生已经按落盘快照恢复了队列。此时若不对账：
 * ① UI 显示空播放器；② `findSong` 反查不到 Song → 过期项无法重解析 → 只能跳歌。
 *
 * 只在「JS 队列为空」或「与原生队列不一致」时重建，避免覆盖前台刚设好的队列。
 */
function reconcileQueueFromNative(state: PlayerState | null, force = false): boolean {
  const tracks = state?.tracks;
  if (!tracks || tracks.length === 0) return false;

  const store = usePlayerStore.getState();
  // 长度相同且已有当前曲时**默认不重建**（避免覆盖前台刚设好的队列）。
  // `force` 用于「下一首播放」：移动分支不改变长度，但**顺序**变了，必须重建。
  if (!force && store.queue.length === tracks.length && store.currentSong) return false;

  const songs: Song[] = tracks.map((track) => ({
    id: track.songId || track.key,
    name: track.title || track.key,
    artist: track.artist ?? undefined,
    album: track.album ?? undefined,
    cover: track.artworkUrl ?? undefined,
    duration: track.durationMs ? track.durationMs / 1000 : undefined,
    sourceType: (track.sourceType as Song['sourceType']) ?? undefined,
    lrc: '',
  } as Song));

  const index = Math.min(Math.max(0, state?.index ?? 0), songs.length - 1);
  usePlayerStore.setState({
    queue: songs,
    currentSong: songs[index],
    currentIndex: index,
    hasPlayed: true,
  });
  // 随机序（#519）：队列被整体重建（冷启/裁剪后对账）→ 把游标对到实际在播的那首。
  // 序列本身不重洗（同会话稳定）；盘上恢复的那份也只做增量对齐。
  usePlayerStore.getState().syncShuffleCursorToCurrent();
  const summary = `已从原生队列对账 ${songs.length} 首（当前第 ${index + 1} 首：${songs[index]?.name ?? ''}）`;
  console.log(`[player] ${summary}`);
  useLogsStore.getState().addLog('info', summary);
  return true;
}

/** 用原生权威快照重建 JS 的列表镜像（裁剪后必须同步）。 */
function syncMirrorFromNative(): void {
  const state = safeState();
  if (state?.tracks?.length) {
    nativeMirror = state.tracks.map((track) => ({ key: track.key, songId: track.songId }));
  }
}

/**
 * 「已经在原生手里」的 key 集合——**按原生当前位置切片**（#495 第 3 条的补窗坑）。
 *
 * 旧的 `new Set(nativeMirror.map(k => k.key))` 是**与位置无关的 key 集合**：它把排在当前曲
 * **之前**的历史也算成「已投喂」。补窗走到队尾绕回队首时，这些 key 会被逐个跳过 → 窗口
 * 整个空掉（连续插队/长会话后尤其明显），原生只能在缓冲边界停下踩空。
 * 按 `state.index` 之后切片后，历史不再挡住绕回的候选。
 *
 * 用原生快照而不是 `nativeMirror` 还有一个原因：插队是**移动**，原生顺序会与 JS 队列顺序
 * 分叉（如 JS [A,B,C,D] vs 原生 [A,C,B]），任何「按 JS 位置去镜像里找」的匹配都会错位。
 * 快照的 `tracks` / `index` 是原生自己的坐标系，天然正确。
 */
function nativeAheadKeys(state: PlayerState | null): Set<string> {
  const tracks = state?.tracks;
  if (!tracks || tracks.length === 0) {
    // 快照里没有队列（服务刚起/未对账）→ 退回镜像全集，宁可少喂也不重复喂
    return new Set(nativeMirror.map((entry) => entry.key));
  }
  const index = Math.min(Math.max(state?.index ?? 0, 0), tracks.length - 1);
  return new Set(tracks.slice(index).map((track) => track.key));
}

/**
 * 「已经在原生 store 里」的 key 集合（#591 的 outcome 判定用）——**全量**，不按位置切片。
 *
 * 与 [nativeAheadKeys] 的区别是刻意的：补窗的「要不要投喂」看的是**当前位置之后**缺什么
 * （绕回队首的候选必须重新投喂）；而 outcome 的 `'deduped'` 看的是「投出去的候选是不是
 * 全已在原生手里」——列表循环/随机的绕回候选恰恰排在当前曲**之前**，按位置切片会漏判成
 * `'grown'`，让 #563 的「末项 + 零新增」重新退回「意图悬空、每 2s 空转」。
 */
function nativeStoreKeys(state: PlayerState | null): Set<string> {
  const tracks = state?.tracks;
  if (!tracks || tracks.length === 0) {
    // 快照里没有队列（服务刚起/未对账）→ 退回镜像全集（与 nativeAheadKeys 同口径）
    return new Set(nativeMirror.map((entry) => entry.key));
  }
  return new Set(tracks.map((track) => track.key));
}

function safeState(): PlayerState | null {
  if (!NativePlayer) return null;
  try {
    return NativePlayer.getState();
  } catch {
    return null;
  }
}

// ── 命令 ────────────────────────────────────────────────

/** 加载 [current] 并立即开播；窗口由紧跟的 `feedWindow()` 补齐（前台补窗优先，§5.4） */
export async function nativePlaySong(song: Song, fresh = false): Promise<Track> {
  const NP = NativePlayer;
  if (!NP) throw new Error('native player unavailable');

  const track = await resolveTrack(song, fresh);
  if (!track) throw new Error('no playable URL');

  const state = safeState();
  nativeMirror = [{ key: track.meta.key, songId: track.songId }];
  markSucceeded(track.meta.key);

  await NP.loadQueue({
    revision: (state?.revision ?? 0) + 1,
    tracks: [track],
    startIndex: 0,
    playWhenReady: true,
    loopMode: toLoopMode(useSettingsStore.getState().playMode),
    policy: currentPolicy(),
  });

  void feedWindow();
  return track;
}

export function nativeTogglePlay(playing: boolean): void {
  const NP = NativePlayer;
  if (!NP) return;
  if (playing) NP.pause();
  else NP.play();
}

export function nativeSeekTo(seconds: number): void {
  NativePlayer?.seek(seconds);
}

/**
 * 原生引擎的推进交付（#555）：**落点由 core planAdvance 单点决定**。
 *
 * `playerStore.advance` 是 planAdvance 的唯一执行者，返回 `{ index, effect }`；
 * 本函数只把「core 决定的落点」落到原生队列上，按 effect + 原生窗口现状选交付方式：
 *
 * - `none`：JS 队列还不可用（冷启对账前的空队列）→ 交回原生按它自己的队列走一步；
 * - `restart-current`：目标就是当前曲（单曲循环 / 单元素队列）→ `seek(0)` 回起点重播，
 *   **不重新解析 URL**（core effect 的契约）；
 * - `load-target`：原生窗口的下一格/上一格恰好就是 core 落点 → 交原生顺序推进
 *   （不打断当前播放、无重缓冲）；否则（会话开头 / 已被裁剪 / 队列与窗口分叉）起播目标曲
 *   ——没有 prepend / 跳项原语，硬走原生 prev 在队首会变成空操作（真机观感「上一首没反应」）。
 *
 * 注：锁屏/媒体会话的 next/prev 由 media3 直接顺序推进，不经本函数；它的正确性来自
 * **原生列表的顺序本身就是 JS 按 core 计划喂出来的窗口**（见 ADR 2026-09-29-native-playback-ownership）。
 */
function nativeStep(direction: 1 | -1): void {
  const NP = NativePlayer;
  if (!NP) return;

  const { index: targetIndex, effect } = usePlayerStore.getState().advance(direction);
  const target = targetIndex >= 0 ? usePlayerStore.getState().queue[targetIndex] : null;

  // JS 队列还不可用（对账前）：交回原生按它自己的队列走一步（含无目标）
  if (!target || effect === 'none') {
    if (direction === 1) NP.next();
    else NP.prev();
    void feedWindow();
    return;
  }

  if (effect === 'restart-current') {
    NP.seek(0);
    NP.play();
    void feedWindow();
    return;
  }

  const native = safeState();
  const neighborKey =
    native && native.index >= 0 ? native.tracks?.[native.index + direction]?.key ?? null : null;
  if (neighborKey && neighborKey === songKey(target)) {
    if (direction === 1) NP.next();
    else NP.prev();
    void feedWindow();
    return;
  }
  // 目标不在原生此刻的相邻位置 → 起播它（`nativePlaySong` 内部自带补窗）
  void nativePlaySong(target);
}

/** UI「下一首」：落点来自 core planAdvance（见 nativeStep）。 */
export function nativeNext(): void {
  nativeStep(1);
}

/** 「下一首播放」的结果（#495）。`reason` 只在 `queued=false` 时有值。 */
export type NativePlayNextResult = {
  queued: boolean;
  moved: boolean;
  /** 队列一字未改（该曲已在下一首位置 / 就是当前曲）——连点幂等 */
  noop: boolean;
  reason?: 'unsupported' | 'failed' | 'unsupported-engine';
};

/**
 * 「下一首播放」（#495）：把 [song] 放到原生队列的**当前曲之后**。
 *
 * 顺序（真机 T2/T9 的教训，别调换）：**先解析**（可能要跑整条 core 解析链，期间原生
 * revision 会因补窗推进）→ **再拿新 revision** patch → `stale` 时重读 revision **重试一次**
 * （用户点了就要落地，不能像补窗那样等下一轮水位事件）→ 成功后**按位置重建镜像**。
 *
 * `stale` 重试的空档如果不重读 revision：正巧撞上原生自动推进/补窗落地，插入会被丢弃，
 * 用户侧表现为「点了下一首播放但没生效」。
 */
export async function nativePlayNext(song: Song): Promise<NativePlayNextResult> {
  const NP = NativePlayer;
  if (!NP) return { queued: false, moved: false, noop: false, reason: 'unsupported-engine' };

  // 不经 `isCoolingDown`（30s 失败冷却）/ `isFresh`（5min 新鲜度）闸门：那是**补窗**的去重策略，
  // 用户显式点「下一首播放」时若沿用，会变成「30s 内静默无效」。这里要么投进去、要么报错。
  const track = await resolveTrack(song, false);
  if (!track) {
    console.warn(`[player] 下一首播放：${song.name} 解析不到可用直链`);
    return { queued: false, moved: false, noop: false, reason: 'failed' };
  }

  let baseRevision = safeState()?.revision ?? 0;
  let result: PatchQueueResult | null = null;
  try {
    result = await NP.patchQueue({ baseRevision, insertAfterCurrent: track });
    if (result.stale) {
      // 原生 revision 在解析期间动过 → 重读一次再投（#495 要求的「重试一次」）
      baseRevision = safeState()?.revision ?? result.revision;
      result = await NP.patchQueue({ baseRevision, insertAfterCurrent: track });
    }
  } catch (error) {
    console.warn(`[player] 下一首播放失败：${song.name}`, error);
    return { queued: false, moved: false, noop: false, reason: 'failed' };
  }

  if (!result.accepted) {
    console.warn(
      `[player] 下一首播放未落地：${song.name} error=${result.error ?? 'unknown'} stale=${result.stale}`
    );
    return { queued: false, moved: false, noop: false, reason: result.error ?? 'failed' };
  }

  // 桥必须给出**正面证据**（changed/queued/moved 任一个是 boolean）才能算落地。
  // 老原生模块（APK 未含 #494 原语）对未知的 `insertAfterCurrent` 字段静默忽略，
  // 回包只有 accepted/revision/stale；旧代码用 `result.changed !== false` 判断，
  // `undefined !== false` 恒真 → 于是提示「已设为下一首」而原生队列一字未改
  // （#518 真机现场：插队后对账仍是 4 首，推进下一首播的是原来的窗口歌）。
  // 宁可报可观测的失败，也不能给用户看「假成功」（#494 验收标准同款要求）。
  const spokeInsert =
    typeof result.changed === 'boolean' ||
    typeof result.queued === 'boolean' ||
    typeof result.moved === 'boolean';
  if (!spokeInsert) {
    console.warn(
      `[player] 下一首播放未落地：${song.name} 原生桥未返回插队语义（原生模块不支持 insertAfterCurrent）`
    );
    return { queued: false, moved: false, noop: false, reason: 'unsupported' };
  }

  markSucceeded(track.meta.key);
  // 按位置重建镜像（不能沿用补窗的 push）：插队后原生顺序变了，镜像必须跟着变，
  // 否则 pruneMirror（按 toKey 切片）与 jsIndex 推导会一路错下去。
  syncMirrorFromNative();
  console.log(
    `[player] 下一首播放：${song.name} queued=${result.queued === true} moved=${result.moved === true} ` +
      `changed=${result.changed === true}`
  );
  // 窗口重算：插队把原来的 index+1 挤到 index+2，位置感知的 excluded 会把它重新纳入候选
  void feedWindow();
  return { queued: true, moved: result.moved === true, noop: result.changed === false };
}

/** UI「上一首」：与 nativeNext 同一条落点判断（见 nativeStep）。 */
export function nativePrev(): void {
  nativeStep(-1);
}

export function nativeStop(): void {
  NativePlayer?.stop();
  nativeMirror = [];
}

export function nativeSyncLoopMode(): void {
  NativePlayer?.setLoop(toLoopMode(useSettingsStore.getState().playMode));
  NativePlayer?.setPolicy(currentPolicy());
}

export function nativeState(): PlayerState | null {
  return safeState();
}

// ── 补窗 ────────────────────────────────────────────────

/**
 * 前台/后台共用的补窗函数（§5.4：两路共用同一条 JS 函数，避免两份解析逻辑）。
 * 增量投喂（`patchQueue({append})`），不重发整表。
 */
export async function feedWindow(need?: number, reason?: NeedReason): Promise<void> {
  const NP = NativePlayer;
  if (!NP) return;

  const playerState = usePlayerStore.getState();
  const queue = playerState.queue;
  if (queue.length === 0) return;

  const nativeStateNow = safeState();
  const nativeKey = nativeStateNow?.key ?? null;
  const currentKey = nativeKey ?? nativeMirror[nativeMirror.length - 1]?.key ?? null;
  const byKey = currentKey ? queue.findIndex((s) => songKey(s) === currentKey) : -1;
  // 原生当前曲反查不到 JS 队列时（对账前的窗口）退回 store 索引
  const jsIndex = byKey >= 0 ? byKey : playerState.currentIndex;
  if (jsIndex < 0) return;

  const playModeNow = useSettingsStore.getState().playMode;
  // 随机序（#519）：进随机后第一次补窗就建一份（懒建，避免 setPlayMode 跨 store 回调）。
  // 已有序列且仍是这批歌 → 只对游标，不重洗。
  if (playModeNow === '随机播放') usePlayerStore.getState().ensureShuffle();
  const shuffleNow = usePlayerStore.getState().shuffle;

  const target = Math.max(1, need ?? currentPolicy().prefetchAhead);
  const existing = nativeAheadKeys(nativeStateNow);
  const wantedIndexes = planNextIndexes(
    queue,
    jsIndex,
    target,
    existing,
    playModeNow,
    shuffleNow
  );

  // #563：本轮计划里是否有候选正被**别的**补窗轮解析（在飞）。有的话，本轮的「零新增」
  // 只是并发去重的空轮，不能当「真的没有下一首」回执原生（否则会把别的轮的结果判成终局）。
  const plannedInFlight = wantedIndexes.some((index) => {
    const song = queue[index];
    return !!song && isInFlight(songKey(song));
  });

  // 并行解析窗口（core 的 tier3 执行器本身有 K=3 闸门，串行只会把补窗时间乘 3，
  // 真机表现为「JS 线程长时间忙碌」）。结果按队列顺序收集，保持 append 顺序稳定。
  const candidates = wantedIndexes
    .map((index) => queue[index])
    .filter((song): song is Song => !!song)
    .filter((song) => {
      const key = songKey(song);
      if (isInFlight(key) || isCoolingDown(key)) return false;
      if (!beginResolve(key)) return false;
      return true;
    });

  const settled = await Promise.all(
    candidates.map(async (song) => {
      const key = songKey(song);
      try {
        const track = await resolveTrack(song, false);
        if (track) {
          markSucceeded(key);
          return track;
        }
        markFailed(key);
        return null;
      } catch {
        markFailed(key);
        return null;
      } finally {
        endResolve(key);
      }
    })
  );
  // 基准稳定性（#518）：本轮计划是在上面那份 `queue` **快照**上算出来的，而解析要花数秒。
  // 期间队列若被整体替换（插队就地同步 / 切歌单 / 对账重建），旧基准算出来的候选绝不能落地
  // —— 真机上「补窗换了基准」正是这么来的：`计划=[28,29,30]` 与 `计划=[0]` 反复横跳。
  // 丢弃是安全的：换基准的那条路径一定会再触发一轮补窗（水位事件 / playSong / 插队）。
  if (usePlayerStore.getState().queue !== queue) {
    console.log('[player] 补窗丢弃：解析期间队列基准已变更');
    return;
  }

  const append: Track[] = settled.filter((track): track is Track => !!track);

  // #591 结算契约：outcome 由 JS 如实上报，原生只读它判定终局。用**投喂前**的原生全量
  // 快照（不是位置切片）比对「候选是不是已在原生手里」——这是原生无论如何数 `addedCount`
  // 都看不见的区分（零候选 vs 稳态绕回）。
  const storeKeys = nativeStoreKeys(nativeStateNow);

  if (append.length === 0) {
    // 零候选：本轮**一个候选都没投出**。并发闸门是契约的一部分——若计划里的候选正被别的
    // 补窗轮解析（plannedInFlight），那一轮会自己给出 `grown`/`deduped`（或它也报 `empty`）；
    // 本轮抢报 `empty` 会把「还在等一轮」误判成终局。闸门外的零候选一律如实上报。
    console.log(
      `[player] 补窗零候选 mode=${useSettingsStore.getState().playMode} reason=${reason ?? '-'} ` +
        `计划=[${wantedIndexes.join(',')}] inFlight=${plannedInFlight}`
    );
    if (plannedInFlight) return;
    try {
      await NP.patchQueue({
        baseRevision: nativeStateNow?.revision ?? 0,
        outcome: 'empty',
      });
    } catch {
      // 上报失败不阻塞：原生仍有 hole 超时 / 水位兜底
    }
    return;
  }

  // `append` 全已在原生 store 里 = 稳态绕回（去重后零新增）→ 本轮唯一的终局信号；
  // 只要有一条是新项就是稳态推进，原生不做终局判定。
  const outcome: PatchOutcome = append.every((track) => storeKeys.has(track.meta.key))
    ? 'deduped'
    : 'grown';

  // T9 取证：窗口定序的计划 vs 实投 vs 结算结论（顺序/随机/绕回都能从这一行看出来）
  console.log(
    `[player] 补窗 mode=${useSettingsStore.getState().playMode} reason=${reason ?? '-'} ` +
      `计划=[${wantedIndexes.join(',')}] 实投=${append.length} outcome=${outcome}`
  );

  const revision = nativeStateNow?.revision ?? 0;
  try {
    const result = await NP.patchQueue({ baseRevision: revision, append, outcome });
    if (result.stale) {
      // 原生 revision 已变（例如刚 loadQueue）→ 丢弃本轮，下一轮水位事件自然重来
      return;
    }
    append.forEach((track) => {
      if (!nativeMirror.some((entry) => entry.key === track.meta.key)) {
        nativeMirror.push({ key: track.meta.key, songId: track.songId });
      }
    });
  } catch {
    // 补窗失败不影响播放：原生会在缓冲边界停下并等下一次补窗
  }
}

/** 原生报「该项 URL 失效」→ 重解析并用 upsert 灌回去（§6.2 第 2 条） */
async function refreshFailedTrack(event: PlaybackErrorEvent): Promise<void> {
  const NP = NativePlayer;
  if (!NP) return;
  const song = findSong(event.songId, event.key);
  if (!song) return;
  try {
    const track = await resolveTrack(song, true);
    if (!track) {
      console.warn(`[player] 过期重试：${song.name} 重解析未拿到可用直链`);
      return;
    }
    const state = safeState();
    const result = await NP.patchQueue({ baseRevision: state?.revision ?? 0, upsert: [track] });
    console.log(
      `[player] 过期重试：${song.name} 已灌入新直链 accepted=${result.accepted} stale=${!!result.stale}`
    );
    if (result.accepted) {
      markSucceeded(track.meta.key);
      useLogsStore.getState().addLog('warn', `《${song.name}》直链失效，已换新 URL 重试`);
    }
  } catch (error) {
    console.warn(`[player] 过期重试失败：${song.name}`, error);
  }
}

// ── headless（后台补窗，§5.1/§5.2） ─────────────────────────

/**
 * JS 模块加载时调用一次：
 * 1) 注册 headless 任务体（与 `feedWindow` 同一条函数）；
 * 2) 把 `HeadlessJsTaskContext` 寄存到原生（§5.2 的 spike 点）。
 */
export function registerNativeHeadless(): boolean {
  if (!NativePlayer) return false;
  if (!headlessRegistered) {
    headlessRegistered = true;
    AppRegistry.registerHeadlessTask(PREFETCH_TASK_KEY, () => async (data?: { reason?: NeedReason }) => {
      try {
        await feedWindow(undefined, data?.reason);
      } catch {
        // headless 任务失败 = 窗口没补上 → 原生在缓冲边界停下（§5.3）
      }
    });
  }
  try {
    return NativePlayer.registerHeadlessHost();
  } catch {
    return false;
  }
}

/** 供诊断/日志用：原生是否可用 + headless 通道是否拿到 */
/**
 * 回前台/冷启对账入口（§4.3）：原生是唯一权威，单向覆盖 store。
 *
 * `force = true` 用于「下一首播放」成功之后：移动分支**队列长度不变但顺序变了**，
 * 默认的「长度相同就不重建」会留下一个顺序错误的 JS 队列（队列页会显示错序）。
 */
export function reconcileFromNative(force = false): void {
  const state = safeState();
  if (reconcileQueueFromNative(state, force)) {
    void feedWindow();
  }
}

export function nativeDiagnostics(): { available: boolean; headless: boolean; state: PlayerState | null } {
  return {
    available: isNativePlayerAvailable,
    headless: headlessRegistered,
    state: safeState(),
  };
}

export type { NativePlayerEvents, ErrorDisposition, ChangeReason, QueueEndedEvent };
