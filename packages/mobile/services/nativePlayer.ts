import { AppRegistry } from 'react-native';
import { getNextSongIndex } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import {
  NativePlayer,
  isNativePlayerAvailable,
  PREFETCH_TASK_KEY,
  type ChangeReason,
  type ErrorDisposition,
  type LoopMode,
  type NativePlayerEvents,
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

/**
 * 原生播放引擎（规格 §2.1/§4.3/§5）。
 *
 * 权威队列在原生；JS 只在活着时**预解析并喂窗口**。事件是通知性质的
 * （I1/I2），回前台用 `getState()` 单向对账，禁止双向写。
 *
 * 本文件不 import `audioPlayer.ts`（避免循环依赖）：需要引擎外的东西时走 hooks。
 */

/** 三层去重的参数（沿用 PR #433 的取值，规格 §5.5） */
const PREFETCH_SKIP_FRESH_MS = 5 * 60 * 1000;
const PREFETCH_FAIL_COOLDOWN_MS = 30 * 1000;
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

/** 在飞去重 + 成功窗口 + 失败冷却（§5.5） */
const prefetchInFlight = new Set<string>();
const prefetchSucceededAt = new Map<string, number>();
const prefetchFailedAt = new Map<string, number>();

export function isNativeEngine(): boolean {
  return isNativePlayerAvailable;
}

export function songKey(song: Song): string {
  return song.id || `${song.name}|${song.artist ?? ''}`;
}

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

  NativePlayer.addListener('trackChanged', (event) => {
    pruneMirror(event.toKey);
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
  });

  NativePlayer.addListener('queueEnded', (event) => {
    hooks.onQueueEnded?.(event);
    if (event.reason !== 'exhausted') void feedWindow();
  });

  NativePlayer.addListener('needTracks', () => {
    void feedWindow();
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
  prefetchSucceededAt.set(track.meta.key, Date.now());

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

export function nativeNext(): void {
  NativePlayer?.next();
  void feedWindow();
}

export function nativePrev(): void {
  NativePlayer?.prev();
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
 * 计划下 N 个待播 index。
 * - 顺序模式：index+1, index+2, …
 * - 随机模式（§7.3 建议方案）：由 JS 按 core 规则定序，原生只顺序推进
 *   → 预取窗口天然知道下一首是谁，锁屏 next 与 UI next 语义一致。
 */
function planNextIndexes(queue: Song[], fromIndex: number, count: number, excluded: Set<string>): number[] {
  const playMode = useSettingsStore.getState().playMode;
  const planned: number[] = [];
  const localExcluded = new Set(excluded);
  let cursor = fromIndex;

  while (planned.length < count) {
    let next: number;
    if (playMode === '随机播放' && queue.length > 1) {
      next = getNextSongIndex(queue, cursor, '随机播放');
      let guard = 0;
      while ((next < 0 || localExcluded.has(songKey(queue[next]))) && guard < queue.length * 2) {
        next = Math.floor(Math.random() * queue.length);
        if (next === cursor) next = (next + 1) % queue.length;
        guard += 1;
      }
      if (next < 0 || localExcluded.has(songKey(queue[next]))) {
        next = cursor + 1;
      }
    } else {
      next = cursor + 1;
    }
    if (next < 0 || next >= queue.length) break;
    if (localExcluded.has(songKey(queue[next]))) {
      cursor = next;
      if (playMode !== '随机播放' && next >= queue.length - 1) break;
      continue;
    }
    localExcluded.add(songKey(queue[next]));
    planned.push(next);
    cursor = next;
    if (playMode === '随机播放') {
      // 随机模式持续随机取，直到取不到新的（用 guard 防死循环）
      if (planned.length >= queue.length - 1) break;
    }
  }
  return planned;
}

/**
 * 前台/后台共用的补窗函数（§5.4：两路共用同一条 JS 函数，避免两份解析逻辑）。
 * 增量投喂（`patchQueue({append})`），不重发整表。
 */
export async function feedWindow(need?: number): Promise<void> {
  const NP = NativePlayer;
  if (!NP) return;

  const playerState = usePlayerStore.getState();
  const queue = playerState.queue;
  if (queue.length === 0) return;

  const nativeStateNow = safeState();
  const currentKey = nativeStateNow?.key ?? nativeMirror[nativeMirror.length - 1]?.key ?? null;
  let jsIndex = currentKey ? queue.findIndex((s) => songKey(s) === currentKey) : -1;
  if (jsIndex < 0) jsIndex = playerState.currentIndex;
  if (jsIndex < 0) return;

  const target = Math.max(1, need ?? currentPolicy().prefetchAhead);
  const existing = new Set(nativeMirror.map((entry) => entry.key));
  const wantedIndexes = planNextIndexes(queue, jsIndex, target, existing);

  const append: Track[] = [];
  for (const index of wantedIndexes) {
    const song = queue[index];
    if (!song) continue;
    const key = songKey(song);
    if (prefetchInFlight.has(key)) continue;
    const failAt = prefetchFailedAt.get(key);
    if (failAt && Date.now() - failAt < PREFETCH_FAIL_COOLDOWN_MS) continue;
    prefetchInFlight.add(key);
    try {
      const track = await resolveTrack(song, false);
      if (track) {
        append.push(track);
        prefetchSucceededAt.set(key, Date.now());
      } else {
        prefetchFailedAt.set(key, Date.now());
      }
    } catch {
      prefetchFailedAt.set(key, Date.now());
    } finally {
      prefetchInFlight.delete(key);
    }
  }

  if (append.length === 0) return;

  const revision = nativeStateNow?.revision ?? 0;
  try {
    const result = await NP.patchQueue({ baseRevision: revision, append });
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
    if (!track) return;
    const state = safeState();
    const result = await NP.patchQueue({ baseRevision: state?.revision ?? 0, upsert: [track] });
    if (result.accepted) {
      prefetchSucceededAt.set(track.meta.key, Date.now());
      useLogsStore.getState().addLog('warn', `《${song.name}》直链失效，已换新 URL 重试`);
    }
  } catch {
    // 交给原生兜底（计数上限 → 跳过）
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
    AppRegistry.registerHeadlessTask(PREFETCH_TASK_KEY, () => async () => {
      try {
        await feedWindow();
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
export function nativeDiagnostics(): { available: boolean; headless: boolean; state: PlayerState | null } {
  return {
    available: isNativePlayerAvailable,
    headless: headlessRegistered,
    state: safeState(),
  };
}

export type { NativePlayerEvents, ErrorDisposition, ChangeReason, QueueEndedEvent };
