import type { PlayMode, Song } from '../types/index.js';
import {
  alignShuffleOrder,
  stepShuffle,
  syncShuffleCursor,
  type ShuffleScope,
  type ShuffleState,
} from './shuffleOrder.js';


/**
 * - `none`：无目标（队列空 / 下标越界）→ 宿主停播；- `restart-current`：目标就是当前曲（单曲循环的
 * 下一首）→ 宿主 seek(0) 重播，**不要**重新解析 URL（避免切走 → reload 的音轨闪烁，桌面既有行为）
 * ；- `load-target`：目标是另一首 → 宿主按 `index` 加载并播放。
 */
export type AdvanceEffect = 'none' | 'restart-current' | 'load-target';

/** 一次推进的完整结果（#541）。 */
export interface AdvancePlan {
  /** 目标歌曲在 `queue` 中的**成员下标**；-1 = 无目标（宿主按 effect='none' 处理）。 */
  index: number;
  /** 推进后的随机序列（游标已前进/后退）；非随机模式原样返回传入的 `shuffle`。 */
  shuffle: ShuffleState | null;
  effect: AdvanceEffect;
}

/** planAdvance 的入参（#541）：`shuffle` **必填**——表达「没有序列」请显式传 `null`。 */
export interface AdvanceInput {
  queue: readonly Song[];
  /** 当前播放曲的成员下标；-1 = 尚无当前曲。 */
  currentIndex: number;
  playMode: PlayMode;
  /**
   * 稳定随机序列。**必填**（#511 评审 major / #541）：此前该参数可选，
   * 移动端两个消费点忘传（audioPlayer.ts 的跳歌选曲与预取），而 core 缺失即静默退回
   * 「防重复现抽」——编译期不报错、运行期换了一套语义。必填后漏传在编译期就断。
   */
  shuffle: ShuffleState | null;
  /** 1 = 下一首，-1 = 上一首。 */
  direction: 1 | -1;
  /**
   * 随机序列的对齐**作用域**（#543/#555）：调用方手里的 `queue` 是完整成员集
   * （`authoritative`，缺省）还是只是原生**预取窗口**（`window`，只补不丢）。
   * 随机分支在推进前用它对序列做增量对齐，所以窗口语义也能走同一条推进路径。
   */
  shuffleScope?: ShuffleScope;
}

/**
 * 推进计划（#541）：**一次推进的唯一事实来源**。
 * 现在组合顺序藏在这里，宿主只按 `effect` 执行。
 */
export function planAdvance(input: AdvanceInput): AdvancePlan {
  const { queue, currentIndex, playMode, shuffle, direction, shuffleScope = 'authoritative' } = input;
  const none: AdvancePlan = { index: -1, shuffle, effect: 'none' };
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return none;

  if (playMode === '单曲循环') {
    // 下一首 = 重播当前曲（桌面既有 seek 行为）；上一首 = 回上一首（不重播）。
    if (direction === 1) return { index: currentIndex, shuffle, effect: 'restart-current' };
    const prevIndex = (currentIndex - 1 + queue.length) % queue.length;
    return { index: prevIndex, shuffle, effect: 'load-target' };
  }

  if (playMode === '随机播放') {
    // 无序列：调用方显式传 null 时才走兼容路径（防重复现抽），有序列则消费序列。
    if (!shuffle) {
      const index = nextRandomIndex(queue, currentIndex);
      return { index, shuffle: null, effect: index === currentIndex ? 'restart-current' : 'load-target' };
    }
    const anchored = alignShuffleOrder(shuffle, queue, currentIndex, shuffleScope);
    const stepped = stepShuffle(anchored, queue, direction, shuffleScope);
    if (stepped.index < 0) return none;
    return {
      index: stepped.index,
      shuffle: stepped.state,
      effect: stepped.index === currentIndex ? 'restart-current' : 'load-target',
    };
  }

  // 列表循环（默认）
  const index = direction === 1
    ? (currentIndex + 1) % queue.length
    : (currentIndex - 1 + queue.length) % queue.length;
  return { index, shuffle, effect: index === currentIndex ? 'restart-current' : 'load-target' };
}

/**
 * 随机播放：有稳定序列（#511 方案 A）时**消费序列游标**（前进一格、回绕）；未提供序列时退回旧的「防
 * 重复现抽」行为（无记忆、不可持久化，仅为不破坏既有调用方而保留，见 core 测试里钉住的「无序列行为
 * 」）。
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
 * 单曲循环与列表循环 → (i-1+len) % len（prev 刻意不做「单曲循环重播」，与现有桌面 playPrevious 行
 * 为保持一致）。
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
function nextRandomIndex(queue: readonly Song[], currentIndex: number): number {
  if (queue.length <= 1) return currentIndex;
  let next: number;
  do {
    next = Math.floor(Math.random() * queue.length);
  } while (next === currentIndex);
  return next;
}
