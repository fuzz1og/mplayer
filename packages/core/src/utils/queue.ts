import type { PlayMode, Song } from '../types/index.js';

/**
 * 按播放模式计算下一首 index（纯函数，无副作用）。
 * 单曲循环 → currentIndex；随机播放 → 防重复随机；列表循环 → (i+1) % len。
 * 队列空或 index 越界 → -1（调用方处理：无下一首）。
 */
export function getNextSongIndex(queue: Song[], currentIndex: number, playMode: PlayMode): number {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return -1;
  if (playMode === '单曲循环') return currentIndex;
  if (playMode === '随机播放') return nextRandomIndex(queue, currentIndex);
  // 列表循环（默认）
  return (currentIndex + 1) % queue.length;
}

/**
 * 按播放模式计算上一首 index（纯函数，无副作用）。
 * 随机播放 → 防重复随机；单曲循环与列表循环 → (i-1+len) % len
 * （prev 刻意不做「单曲循环重播」，与现有桌面 playPrevious 行为保持一致）。
 * 队列空或 index 越界 → -1（调用方处理：无上一首）。
 */
export function getPrevSongIndex(queue: Song[], currentIndex: number, playMode: PlayMode): number {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return -1;
  if (playMode === '随机播放') return nextRandomIndex(queue, currentIndex);
  return (currentIndex - 1 + queue.length) % queue.length;
}

/** 随机防重复 index：队列 ≤ 1 归位 currentIndex，否则随机到不等于 currentIndex */
function nextRandomIndex(queue: Song[], currentIndex: number): number {
  if (queue.length <= 1) return currentIndex;
  let next: number;
  do {
    next = Math.floor(Math.random() * queue.length);
  } while (next === currentIndex);
  return next;
}
