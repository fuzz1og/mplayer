import type { LyricsHydrationCandidate } from '@mplayer/core';
import { enqueueLyricsHydration } from '@mplayer/core';
import type { SongListRow } from './songListLayout';

/**
 * 「行进入视口」→ 歌词预取（#429）的**停稳闸**。
 *
 * 为什么不能见到可见行就入队：#421 的教训是滚动期抢帧，而一次性甩动会让 FlatList
 * 连续报出十几屏行——照单全收等于把整份歌单打出去（#409 刚从「列表内联取词」把这个
 * 请求量收回来）。所以这里只认**停稳**：可见集合 `VIEWPORT_SETTLE_MS` 内不再变化，
 * 才把当前这一屏交给 core `lyricsHydrator`；滑动中的中间集合一律丢弃（用户滑过去
 * 没停下来看的行，本来也不会点开）。
 *
 * 闸设在**入队**这一侧（消费端的可见性策略），不是出网侧：并发上限与每 host 限速
 * 仍然只有 transport 双层闸门（#408）一套。
 *
 * 抽成零 react-native 依赖的纯函数 + 可注入 `enqueue`，是为了「视口 → 候选 → 停稳」
 * 三步都能在 node 下直接测（mobile 的 vitest 是 node 环境，渲染 FlatList 不在范围内）。
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

export interface ViewportLyricsSettlerOptions {
  /** 停稳判定窗口（毫秒），默认 `VIEWPORT_SETTLE_MS`。 */
  settleMs?: number;
  /** 交付回调，默认直接交给 core hydrator；测试注入以便断言「出网了几次」。 */
  enqueue?: (candidates: LyricsHydrationCandidate[]) => void;
}

export interface ViewportLyricsSettler {
  /** 每次视口变化调用一次，传**当前**可见行（只传变化的那些行会漏掉「停稳时的全景」）。 */
  onViewableRows(rows: readonly SongListRow[]): void;
  /** 立刻结算待交付的可见集合（不等停稳窗口）。 */
  flush(): void;
  /** 丢弃待交付项并停表（列表卸载；已在飞的取词由 `cancelLyricsHydration` 收回）。 */
  dispose(): void;
}

export function createViewportLyricsSettler(
  options: ViewportLyricsSettlerOptions = {}
): ViewportLyricsSettler {
  const settleMs = options.settleMs ?? VIEWPORT_SETTLE_MS;
  const enqueue = options.enqueue ?? enqueueLyricsHydration;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: readonly SongListRow[] = [];

  const clear = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  const emit = () => {
    const candidates = lyricsCandidatesOfRows(latest);
    if (candidates.length > 0) enqueue(candidates);
  };

  return {
    onViewableRows(rows) {
      latest = rows;
      // 每次可见集合变化都把停稳窗口推后：滑动期间这个表永远等不到到期。
      clear();
      timer = setTimeout(() => {
        timer = null;
        emit();
      }, settleMs);
    },
    flush() {
      clear();
      emit();
    },
    dispose() {
      clear();
      latest = [];
    },
  };
}
