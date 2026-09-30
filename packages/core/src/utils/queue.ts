import type { PlayMode, Song } from '../types/index.js';
import { stepShuffle, syncShuffleCursor, type ShuffleState } from './shuffleOrder.js';

/**
 * 按播放模式计算下一首 index（纯函数，无副作用）。
 * 单曲循环 → currentIndex；列表循环 → (i+1) % len。
 * 随机播放：有稳定序列（#511 方案 A）时**消费序列游标**（前进一格、回绕）；
 *           未提供序列时退回旧的「防重复现抽」行为（无记忆、不可持久化，
 *           仅为不破坏既有调用方而保留，见 core 测试里钉住的「无序列行为」）。
 * 队列空或 index 越界 → -1（调用方处理：无下一首）。
 */
export function getNextSongIndex(
  queue: Song[],
  currentIndex: number,
  playMode: PlayMode,
  shuffle?: ShuffleState | null,
): number {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return -1;
  if (playMode === '单曲循环') return currentIndex;
  if (playMode === '随机播放') {
    if (!shuffle) return nextRandomIndex(queue, currentIndex);
    return stepShuffle(syncShuffleCursor(shuffle, queue, currentIndex), queue, 1).index;
  }
  // 列表循环（默认）
  return (currentIndex + 1) % queue.length;
}

/**
 * 按播放模式计算上一首 index（纯函数，无副作用）。
 * 单曲循环与列表循环 → (i-1+len) % len
 * （prev 刻意不做「单曲循环重播」，与现有桌面 playPrevious 行为保持一致）。
 * 随机播放（#511 **行为变更**）：有稳定序列时游标**后退一格**，回到序列里的上一张；
 *           此前与 next 共用同一「现抽」→ 回的是一张新随机曲，从不回上一张。
 *           无序列时保留旧现抽行为。
 * 队列空或 index 越界 → -1（调用方处理：无上一首）。
 */
export function getPrevSongIndex(
  queue: Song[],
  currentIndex: number,
  playMode: PlayMode,
  shuffle?: ShuffleState | null,
): number {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return -1;
  if (playMode === '随机播放') {
    if (!shuffle) return nextRandomIndex(queue, currentIndex);
    return stepShuffle(syncShuffleCursor(shuffle, queue, currentIndex), queue, -1).index;
  }
  return (currentIndex - 1 + queue.length) % queue.length;
}

/** 随机防重复 index：队列 ≤ 1 归位 currentIndex，否则随机到不等于 currentIndex。
 *  **无序列时的兼容路径**：只在调用方没有稳定随机序列（#511）时走到。
 */
function nextRandomIndex(queue: Song[], currentIndex: number): number {
  if (queue.length <= 1) return currentIndex;
  let next: number;
  do {
    next = Math.floor(Math.random() * queue.length);
  } while (next === currentIndex);
  return next;
}
