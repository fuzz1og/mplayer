import type { LyricsHydrationCandidate } from '@mplayer/core';
import { cancelLyricsHydration, enqueueLyricsHydration } from '@mplayer/core';
import type { SongListRow } from './songListLayout';

/**
 * 「行进入视口」→ 歌词预取（#429）的**停稳闸 + 可见集合差集**。
 *
 * 为什么不能见到可见行就入队：#421 的教训是滚动期抢帧，而一次性甩动会让 FlatList
 * 连续报出十几屏行——照单全收等于把整份歌单打出去（#409 刚从「列表内联取词」把这个
 * 请求量收回来）。所以这里只认**停稳**：可见集合 `VIEWPORT_SETTLE_MS` 内不再变化，
 * 才在停稳那一拍做两件事——把**当前这一屏**交给 core `lyricsHydrator`，并算出
 * **本次离开可见集合的 key** 交给 `cancelLyricsHydration`。滑动中的中间集合一律丢弃
 * （用户滑过去没停下来看的行，本来也不会点开）。
 *
 * **刻意严于票面的一处语义**：票面写的是「行进入视口即入队」，实现取的是
 * 「**可见集合停稳 `VIEWPORT_SETTLE_MS` 后按整屏请求**」——滑过但未停稳的行不会请求。
 * 这是 #421 防抢帧的取舍（每帧入队会把甩动经过的整份歌单打出去），代价是「快速滑过去
 * 又马上点开」的那几行没有预取，兜底仍是播放期取词。
 *
 * 差集只在**停稳那一拍**算，绝不在滚动每帧算：取消成本 O(离开行数)，已结算的 key 在
 * hydrator 里本就跳过。`delivered` 只记「上一次停稳时交付过的候选」，所以收回的是
 * **真的滑出可见集合**的那些行，滑动途中的中间集合不参与。
 *
 * 闸设在**入队**这一侧（消费端的可见性策略），不是出网侧：并发上限与每 host 限速
 * 仍然只有 transport 双层闸门（#408）一套。
 *
 * 抽成零 react-native 依赖的纯函数 + 可注入 `enqueue`/`cancel`，是为了「视口 → 候选 →
 * 停稳 → 入队/收回」几步都能在 node 下直接测（mobile 的 vitest 是 node 环境，
 * 渲染 FlatList 不在范围内）。
 */

/** 可见集合稳定多久才算「停稳」。取 300ms：短于人的「停下来看一眼」节奏，长于滑动帧间隔。 */
export const VIEWPORT_SETTLE_MS = 300;

/** 只有歌曲行是候选：分区头 / 组头没有歌可预取（#411 把搜索页的组拍平成这两种行）。 */
export function lyricsCandidatesOfRows(
  rows: readonly SongListRow[]
): LyricsHydrationCandidate[] {
  const candidates: LyricsHydrationCandidate[] = [];
  for (const row of rows) {
    if (row.kind !== 'song') continue;
    candidates.push({ sourceType: row.song.sourceType, id: row.song.id });
  }
  return candidates;
}

/**
 * 候选身份键（`源:id`）——**与 `SongList` 卸载收回账本用的是同一个键**，
 * 也是可见集合差集的比较单位。
 *
 * 缺源或缺 id 返回 null：这种候选 hydrator 本来就不认（`hydratableId`），
 * 更不该参与差集（否则一堆 null 会被当成「同一个 key」）。
 */
export function lyricsCandidateKey(candidate: LyricsHydrationCandidate): string | null {
  const id = candidate.id === undefined || candidate.id === null ? '' : String(candidate.id);
  if (!candidate.sourceType || !id) return null;
  return `${candidate.sourceType}:${id}`;
}

export interface ViewportLyricsSettlerOptions {
  /** 停稳判定窗口（毫秒），默认 `VIEWPORT_SETTLE_MS`。 */
  settleMs?: number;
  /** 交付回调，默认直接交给 core hydrator；测试注入以便断言「出网了几次」。 */
  enqueue?: (candidates: LyricsHydrationCandidate[]) => void;
  /** 收回回调（本次离开可见集合的候选），默认 core `cancelLyricsHydration`。 */
  cancel?: (candidates: LyricsHydrationCandidate[]) => void;
}

export interface ViewportLyricsSettler {
  /** 每次视口变化调用一次，传**当前**可见行（只传变化的那些行会漏掉「停稳时的全景」）。 */
  onViewableRows(rows: readonly SongListRow[]): void;
  /** 立刻结算待交付的可见集合（不等停稳窗口）；差集与收回同拍完成。 */
  flush(): void;
  /** 丢弃待交付项与差集基线并停表（列表卸载；已在飞的取词由 `cancelLyricsHydration` 收回）。 */
  dispose(): void;
}

export function createViewportLyricsSettler(
  options: ViewportLyricsSettlerOptions = {}
): ViewportLyricsSettler {
  const settleMs = options.settleMs ?? VIEWPORT_SETTLE_MS;
  const enqueue = options.enqueue ?? enqueueLyricsHydration;
  const cancel = options.cancel ?? cancelLyricsHydration;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: readonly SongListRow[] = [];
  /** 上一次**停稳那一拍**交付过的候选（key → 候选）：本次差集的基线。 */
  let delivered = new Map<string, LyricsHydrationCandidate>();

  const clear = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  /**
   * 停稳那一拍：先按基线算「本次离开可见集合的 key」并收回，再交付当前整屏。
   * 顺序无关紧要（两边都只碰自己的 key），但「滑出的先收回」语义更直白。
   */
  const settle = () => {
    const candidates = lyricsCandidatesOfRows(latest);
    const current = new Map<string, LyricsHydrationCandidate>();
    for (const candidate of candidates) {
      const key = lyricsCandidateKey(candidate);
      if (key !== null) current.set(key, candidate);
    }
    const left: LyricsHydrationCandidate[] = [];
    for (const [key, candidate] of delivered) {
      if (!current.has(key)) left.push(candidate);
    }
    delivered = current;
    if (left.length > 0) cancel(left);
    if (candidates.length > 0) enqueue(candidates);
  };

  return {
    onViewableRows(rows) {
      latest = rows;
      // 每次可见集合变化都把停稳窗口推后：滑动期间这个表永远等不到到期。
      clear();
      timer = setTimeout(() => {
        timer = null;
        settle();
      }, settleMs);
    },
    flush() {
      clear();
      settle();
    },
    dispose() {
      clear();
      latest = [];
      // 卸载时在飞取词的收回由调用方负责（只有它知道自己入队过哪些 key）；这里丢掉
      // 差集基线，避免同一 settler 被复用时把上一轮的 key 误判成「本次离开」。
      delivered = new Map();
    },
  };
}
