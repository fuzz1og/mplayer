import type { SourceKey } from '../types/index.js';
import type { TransportCallOptions } from '../api/transport.js';
import { getNeteaseLyrics } from '../api/neteaseDirect.js';

/**
 * 歌词入队取词（#429）：把「取词时机」从播放期提前到**可见期**的深模块。
 * **明确不做**（边界见 #429 / ADR `2026-09-26-outbound-request-governance`）：本模块**不持有任何并发上限与出网限速**
 * ——那是 `api/transport` 双层闸门的唯一职责；这里派发的每次取词都只是 `request()` 的一个排队者。
 */

/** 单个候选：`Song` 直接满足该形状（多出的字段不影响）。 */
export interface LyricsHydrationCandidate {
  sourceType?: SourceKey | null;
  id?: string | number | null;
}

/** 取词器：默认 = 网易按 songId 直取；宿主可注入（桌面渲染层经 IPC 走主进程缓存）。 */
export type LyricsFetcher = (songId: string, options?: TransportCallOptions) => Promise<string>;

export interface LyricsHydratorDeps {
  fetchLyrics?: LyricsFetcher | null;
}

export interface LyricsHydrationStats {
  /** 会话内已派发的取词次数（含在飞与已结算）。 */
  dispatched: number;
  /** 因在飞/已结算被跳过的入队次数（single-flight 命中数）。 */
  deduped: number;
  /** 因单次入队接纳上限被丢弃的候选数。 */
  dropped: number;
  /** 源不在预取范围（当前只做网易）被跳过的候选数。 */
  unsupported: number;
  /** 被取消的在飞取词数。 */
  cancelled: number;
  /** 取词器抛错的次数（网易实现内部吞错时不计数）。 */
  failed: number;
  /** 当前在飞取词数。 */
  inFlight: number;
  /** 当前已结算的 songId 数（有上限）。 */
  settled: number;
}

/**
 * **单次入队**接纳上限（不是吞吐上限、更不是时间预算，口径见模块头注释）。
 * 正常调用方（移动端停稳闸每次只交一屏）永远碰不到这个值——碰到它就是调用方没分批，是 bug 信号而不
 * 是常态。
 */
export const LYRICS_HYDRATION_BURST_CAP = 30;

/** 已结算记忆上限：超限整体清空（真缓存仍在，重新入队命中零请求）。 */
export const LYRICS_HYDRATION_SETTLED_LIMIT = 500;

/** 当前可预取的源：网易有 `getNeteaseLyrics` 这条「按 songId 直取」链路。 */
function hydratableId(candidate: LyricsHydrationCandidate): string | null {
  if (candidate.sourceType !== 'netease') return null;
  const id = candidate.id === undefined || candidate.id === null ? '' : String(candidate.id);
  return id ? id : null;
}

const DEFAULT_FETCHER: LyricsFetcher = getNeteaseLyrics;

let deps: { fetchLyrics: LyricsFetcher } = { fetchLyrics: DEFAULT_FETCHER };
/** 在飞取词：songId → 取消器。 */
const inFlight = new Map<string, AbortController>();
/** 会话内已结算（成功/空词/失败）的 songId。 */
const settled = new Set<string>();
/** `awaitLyricsHydrationIdle` 的等待者：在飞清零时一起唤醒。 */
const idleWaiters = new Set<() => void>();
let stats = emptyStats();

function emptyStats(): LyricsHydrationStats {
  return {
    dispatched: 0,
    deduped: 0,
    dropped: 0,
    unsupported: 0,
    cancelled: 0,
    failed: 0,
    inFlight: 0,
    settled: 0,
  };
}

/**
 * 入队一批「刚进入视口」的候选。**同步返回**：即时派发，排队与限速在 transport。
 */
export function enqueueLyricsHydration(
  candidates: LyricsHydrationCandidate | readonly LyricsHydrationCandidate[],
): void {
  const list = Array.isArray(candidates) ? candidates : [candidates as LyricsHydrationCandidate];
  let accepted = 0;
  for (const candidate of list) {
    const songId = hydratableId(candidate);
    if (!songId) {
      stats.unsupported += 1;
      continue;
    }
    if (inFlight.has(songId) || settled.has(songId)) {
      stats.deduped += 1;
      continue;
    }
    if (accepted >= LYRICS_HYDRATION_BURST_CAP) {
      stats.dropped += 1;
      continue;
    }
    accepted += 1;
    dispatch(songId);
  }
}

function dispatch(songId: string): void {
  const controller = new AbortController();
  inFlight.set(songId, controller);
  stats.dispatched += 1;
  stats.inFlight = inFlight.size;

  void (async () => {
    try {
      await deps.fetchLyrics(songId, { signal: controller.signal });
    } catch {
      // 取词器自身上抛（网易实现内部吞错，这里兜底层实现）。取消不算失败。
      if (!controller.signal.aborted) stats.failed += 1;
    } finally {
      // 取消时 `cancelOne` 已经把这条从在飞表里摘掉（且不计入结算），这里只兜正常路径。
      if (inFlight.get(songId) === controller) {
        inFlight.delete(songId);
        stats.inFlight = inFlight.size;
        if (!controller.signal.aborted) rememberSettled(songId);
        notifyIfIdle();
      }
    }
  })();
}

function notifyIfIdle(): void {
  if (inFlight.size > 0) return;
  for (const resolve of [...idleWaiters]) resolve();
  idleWaiters.clear();
}

/**
 * 已结算记忆：成功、**空词**（网易空词也进缓存）与失败一视同仁。
 * 失败不重试是刻意的——预取是 best-effort，滚动反复触发的重试就是风暴；
 * 真正的兜底在播放期取词（那条路径有用户可见价值）。
 */
function rememberSettled(songId: string): void {
  if (settled.size >= LYRICS_HYDRATION_SETTLED_LIMIT) settled.clear();
  settled.add(songId);
  stats.settled = settled.size;
}

/**
 * 取消一批候选的在飞取词（行离开视口 / 列表卸载）。
 * 已被 transport 排队、尚未进入底层传输的请求会**从队列摘除**（#408 的协作式取消），因此「取消后不
 * 再出网」是真的不再出网，而不只是丢弃结果。
 */
export function cancelLyricsHydration(
  candidates: LyricsHydrationCandidate | readonly LyricsHydrationCandidate[],
): void {
  const list = Array.isArray(candidates) ? candidates : [candidates as LyricsHydrationCandidate];
  for (const candidate of list) {
    const songId = hydratableId(candidate);
    if (!songId) continue;
    cancelOne(songId);
  }
}

function cancelOne(songId: string): void {
  const controller = inFlight.get(songId);
  if (!controller) return;
  inFlight.delete(songId);
  stats.inFlight = inFlight.size;
  stats.cancelled += 1;
  controller.abort();
  notifyIfIdle();
}

/** 取消所有在飞取词（全局会话级清场；列表卸载请用 `cancelLyricsHydration` 只收自己的）。 */
export function cancelAllLyricsHydration(): void {
  for (const songId of [...inFlight.keys()]) cancelOne(songId);
}

/** 等当前在飞的取词结算（无在飞时立即返回）。宿主诊断与测试用。 */
export function awaitLyricsHydrationIdle(): Promise<void> {
  if (inFlight.size === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    idleWaiters.add(resolve);
  });
}

export function getLyricsHydrationStats(): LyricsHydrationStats {
  return { ...stats, inFlight: inFlight.size, settled: settled.size };
}

/** 注入取词器（测试 / 桌面渲染层经 IPC 注入）；传 null 或省略 fetchLyrics 恢复默认。 */
export function setLyricsHydratorDeps(next: LyricsHydratorDeps | null): void {
  deps = { fetchLyrics: next?.fetchLyrics ?? DEFAULT_FETCHER };
}

/** 重置（会话切换 / 测试）：取消在飞、清空已结算与统计。 */
export function resetLyricsHydrator(): void {
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
  settled.clear();
  notifyIfIdle();
  stats = emptyStats();
}
