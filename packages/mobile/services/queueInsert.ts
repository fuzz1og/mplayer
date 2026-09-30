import type { Song } from '@mplayer/core';
import { prefetchKey } from './queuePrefetch';

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
 * ⚠️ **随机播放分支尚未定义**（用户在决策「固定插到随机序列里的下一位置」；core 的
 * `getNextSongIndex` 随机分支今天是「每次现随机、无记忆」，没有稳定序列可插）。
 * 所以这里**不发明**随机语义：`playMode === '随机播放'` 暂按顺序路径返回。
 * 结论落地后**只改这一个函数**——入参已含 playMode，返回的是完整 sequence，
 * 双端（iOS/回落引擎的 splice、Android 原生 index+1）一起生效，调用方零改动。
 */
export function planPlayNext(queue: Song[], currentIndex: number, song: Song, playMode: string): PlayNextPlan {
  void playMode; // 随机分支待定义：唯一接缝放在这里

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