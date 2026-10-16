import type { ShuffleState, Song } from '@mplayer/core';
import { createShuffleState, insertNextInShuffle } from '@mplayer/core';
import { prefetchKey } from './queuePrefetch';
import { sameOrder } from './shuffleMode';

/**
 * 「下一首播放」的规划结果（#495）。
 * - [sequence]：**最终队列**（纯函数，不改入参）。
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
 * 插入点恒为「当前曲之后」（currentIndex + 1），当前 index 不动、不打断当前曲。
 * ⚠️ **随机分支**（#519）不在这里：随机序是与成员序并列的**另一份数据**（`ShuffleState`），本函数返回的是成员序 sequence。
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
 * ⚠️ 调用方需保证 `song.id` 与队列里各首的 id 都非空（core 的序列以歌曲 id 为身份）；无 id 的歌走
 * 顺序路径（见 `playerStore.insertNext` 的分派条件）。
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
