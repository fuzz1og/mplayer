import type { PlayMode, Song } from '../types/index.js';
import {
  alignShuffleOrder,
  stepShuffle,
  syncShuffleCursor,
  type ShuffleScope,
  type ShuffleState,
} from './shuffleOrder.js';


/**
 * 宿主该执行的落点动作（#541）：core 只回答「推进到哪」，**怎么落**由宿主按它执行。
 * - `none`：无目标（队列空 / 下标越界）→ 宿主停播；
 * - `restart-current`：目标就是当前曲（单曲循环的下一首）→ 宿主 seek(0) 重播，
 *   **不要**重新解析 URL（避免切走 → reload 的音轨闪烁，桌面既有行为）；
 * - `load-target`：目标是另一首 → 宿主按 `index` 加载并播放。
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
 *
 * 此前「推进到哪」在 core（`getNextSongIndex`）而「怎么落」散在三个宿主
 * （桌面 playerStore 约 40 行分派 / 移动 store 约 35 行 / 原生桥约 30 行），
 * 且每个入口都要各自记得「先同步游标 → 再步进 → 再把结果写回」这条纪律
 * （#520 的注释说明它靠人记）。现在组合顺序藏在这里，宿主只按 `effect` 执行。
 *
 * 语义契约（与 ADR 2026-09-30 一致）：
 * - 队列空 / 下标越界 → `{ index: -1, effect: 'none' }`；
 * - 单曲循环 + 下一首 → `restart-current`（重播当前曲，不重新解析）；
 * - 单曲循环 + **上一首** → `load-target` 回到上一首（**不**重播当前曲）。
 *   这条此前只写在注释里（「与桌面 playPrevious 保持一致」）而移动端实际是重播，
 *   现在它是可执行契约，两端同此；
 * - 随机播放 → **先按 `shuffleScope` 对齐序列**（成员增量 + 游标对到当前曲），
 *   再沿序列前进/后退一格并回绕，返回推进后的序列；
 * - 列表循环 → (i ± 1 + len) % len，序列原样返回。
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
function nextRandomIndex(queue: readonly Song[], currentIndex: number): number {
  if (queue.length <= 1) return currentIndex;
  let next: number;
  do {
    next = Math.floor(Math.random() * queue.length);
  } while (next === currentIndex);
  return next;
}
