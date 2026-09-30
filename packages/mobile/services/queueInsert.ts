import type { ShuffleState, Song } from '@mplayer/core';
import { createShuffleState, insertNextInShuffle } from '@mplayer/core';
import { prefetchKey } from './queuePrefetch';
import { sameOrder } from './shuffleMode';

/**
 * 「下一首播放」的规划结果（#495）。
 *
 * - [sequence]：**最终队列**（纯函数，不改入参）。调用方直接用即可——这么设计是为了
 *   让「已在序列里 → 先摘再插」的下标数学只有一份，调用方不需要自己 ±1；
 * - [insertAt]：插进去的下标（= 当前曲下标 + 1）；
 * - [alreadyInSequence]：该曲此前已在队列里（移动分支）；
 * - [moved]：本次确实把它从别处挪动了（false = 新插入，或幂等命中没动）；
 * - [noop]：该曲已经恰好在「下一首」位置 —— 连点两次结果稳定，队列一字不改。
 */
export interface PlayNextPlan {
  sequence: Song[];
  insertAt: number;
  alreadyInSequence: boolean;
  moved: boolean;
  noop: boolean;
}

/**
 * 「下一首播放」的插入位置——**唯一接缝**（#495）。
 *
 * 语义与桌面 PR #506（`src/renderer/utils/reorder.ts` 的 `insertAfter`/`moveItem` +
 * `playerStore.insertNext`）逐条对齐，双端**行为必须一致**：
 * - 插入点恒为「当前曲之后」（currentIndex + 1），当前 index 不动、不打断当前曲；
 * - 已在队列 → **移动**（不复制，队列长度不变），且**保留队列里那份 Song 对象**
 *   （用户点的可能来自刚刷新的列表，封面/时长不同；「已在队列」的语义是挪位置，
 *   静默换掉一份元数据会让队列条目突变）；
 * - 已在「当前曲之后」这一位 → no-op（连点幂等）；
 * - 点的是正在播的这一首 → no-op；
 * - 队列为空 / 没有当前曲（currentIndex < 0）→ 调用方走「直接开始播放」（见
 *   `stores/playerStore.insertNext` 的 started 分支），这里只负责纯队列数学。
 *
 * ⚠️ **随机分支**（#519）不在这里：随机序是与成员序并列的**另一份数据**（`ShuffleState`），
 * 而本函数返回的是成员序 sequence。随机的落点见下面的 `planPlayNextShuffle`——
 * 成员序不因随机被重排，随机由 core `insertNextInShuffle` 放到「序列里当前曲的下一格」。
 * 调用方（`stores/playerStore.ts`）按 playMode 分派；顺序模式的语义与桌面 #506 逐条对齐不变。
 */
export function planPlayNext(queue: Song[], currentIndex: number, song: Song, playMode: string): PlayNextPlan {
  void playMode; // 随机分支在 planPlayNextShuffle：唯一接缝仍在本文件

  const key = prefetchKey(song);
  const at = queue.findIndex((s) => prefetchKey(s) === key);
  // 当前曲下标：currentIndex 越界时夹回合法区间（没有当前曲 = -1 由调用方处理）
  const current = queue.length === 0 ? -1 : Math.min(Math.max(currentIndex, 0), queue.length - 1);

  if (at >= 0 && (at === current || at === current + 1)) {
    return { sequence: [...queue], insertAt: current + 1, alreadyInSequence: true, moved: false, noop: true };
  }

  const next = [...queue];
  let removedBeforeTarget = false;
  let existing: Song | null = null;
  if (at >= 0) {
    existing = next[at];
    next.splice(at, 1);
    removedBeforeTarget = at < current;
  }
  const anchor = removedBeforeTarget ? current - 1 : current;
  const insertAt = Math.min(anchor + 1, next.length);
  // 移动分支保留队列里那份对象（与桌面 #506 同口径）
  next.splice(insertAt, 0, at >= 0 && existing ? existing : song);
  return { sequence: next, insertAt, alreadyInSequence: at >= 0, moved: at >= 0, noop: false };
}

/** 随机模式下的「下一首播放」规划（#519）：成员 + 随机序两份结果。 */
export interface PlayNextShufflePlan {
  /** 成员序（新歌**追加到末尾**；已在队列则原样保留同一份数组引用）。 */
  queue: Song[];
  /** 随机序（把该曲放到序列里当前曲的下一格；幂等命中时原样）。 */
  shuffle: ShuffleState;
  /** 该曲此前已在队列里（移动语义，与顺序路径同口径）。 */
  moved: boolean;
  /** 一字未改（已在「当前曲下一格」/ 点的是当前曲）——连点幂等。 */
  noop: boolean;
}

/**
 * 随机模式的「下一首播放」（#519）：**成员序不动、随机序移动**。
 *
 * 语义全部来自 core `insertNextInShuffle`（与桌面 #506 的 insertNext 同一条契约）：
 * - 插入点是「当前曲在**序列**里的下一格」（不是成员下标 currentIndex+1）；
 * - 已在序列 → 移动（不复制、保留队列里那份 Song 对象）；
 * - 已在目标格 / 点的是当前曲 → no-op（连点幂等）；
 * - 成员由调用方维护：不在队列的新歌**追加到成员末尾**（列表循环序拿到的是追加语义）。
 *
 * ⚠️ 调用方需保证 `song.id` 与队列里各首的 id 都非空（core 的序列以歌曲 id 为身份）；
 * 无 id 的歌走顺序路径（见 `playerStore.insertNext` 的分派条件）。
 */
export function planPlayNextShuffle(
  queue: Song[],
  currentIndex: number,
  song: Song,
  shuffle: ShuffleState | null,
): PlayNextShufflePlan {
  const key = prefetchKey(song);
  const existing = queue.findIndex((s) => prefetchKey(s) === key);
  const nextQueue = existing >= 0 ? queue : [...queue, song];
  const current = queue.length === 0 ? -1 : Math.min(Math.max(currentIndex, 0), queue.length - 1);
  const base = shuffle ?? createShuffleState(nextQueue, { currentIndex: current });
  const nextShuffle = insertNextInShuffle(base, nextQueue, song.id, current);
  return {
    queue: nextQueue,
    shuffle: nextShuffle,
    moved: existing >= 0,
    // 幂等判据：序列一字未改（core 在「已在下一格 / 点的是当前曲」时原样返回）
    noop: sameOrder(nextShuffle.order, base.order) && nextQueue === queue,
  };
}