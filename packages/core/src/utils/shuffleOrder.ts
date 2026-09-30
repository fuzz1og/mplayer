import type { Song } from '../types/index.js';

/**
 * 稳定随机序列（#511 方案 A）。
 *
 * 随机播放不再是「每次实时抽一个 ≠ 当前」——那没有记忆、无法持久化，且 next/prev
 * 共用同一抽法导致「上一首」不回上一张。本模块把随机建模为一份**可序列化的
 * 洗牌序 + 游标**：洗牌一次、由游标推进/后退，双端 playerStore 各持一份。
 *
 * 设计约束：
 * - 纯函数、零 I/O、零模块级状态（同一份语义双端只有这一处实现）；
 * - 「序列 + 游标」本身即可 JSON 序列化（localStorage / AsyncStorage 直接存对象）；
 * - 队列成员变化（加歌/删歌/换源）只做**增量对齐**，不重洗——顺序在会话内稳定；
 *   只有整批换队列（进新歌单）才由调用方重新洗牌。
 */

/** 洗牌序 + 游标：随机播放的完整可持久化状态。 */
export interface ShuffleState {
  /** 洗牌后的歌曲 id 顺序（正常情况下是队列 id 的一个排列）。 */
  order: string[];
  /**
   * 当前播放曲在 [order] 中的下标。
   * `-1` = 尚无当前曲（语义上处于序列起点**之前**）：next 落到 `order[0]`，
   * prev 回绕到 `order[order.length - 1]`。
   */
  cursor: number;
}

/** 一次游标推进的结果：目标曲在 queue 中的下标 + 推进后的序列。 */
export interface ShuffleStep {
  /** 目标曲在 `queue` 里的下标；`-1` = 无目标（队列为空）。 */
  index: number;
  /** 推进后的序列（新对象，入参不被修改）。 */
  state: ShuffleState;
}

/** 洗牌随机源：默认 `Math.random`；测试注入确定性序列即可复现整条顺序。 */
export type ShuffleRng = () => number;

export interface CreateShuffleOptions {
  /** 可注入随机源（Fisher–Yates 每一步都只消费它）。 */
  rng?: ShuffleRng;
  /** 当前播放曲在 queue 中的下标；合法时游标落在它身上，非法/缺省为 -1。 */
  currentIndex?: number;
}

/**
 * 洗一次牌（Fisher–Yates）。`currentIndex` 合法时游标指向当前曲在洗牌序中的位置，
 * 于是「下一首」从当前曲之后继续，「上一首」回到它在序列里的前一张。
 */
export function createShuffleState(
  queue: readonly Song[],
  options: CreateShuffleOptions = {},
): ShuffleState {
  const { rng = Math.random, currentIndex = -1 } = options;
  const order = queue.map((song) => song.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  const currentId = songIdAt(queue, currentIndex);
  return { order, cursor: currentId ? order.indexOf(currentId) : -1 };
}

/**
 * 队列成员变化后的**增量对齐**：丢掉已不在队列的 id、把新进队列的 id 追加到末尾
 * （即「刚加进来的歌排在随机序最后」），游标跟随它原先指向的那首歌。
 * 不改相对顺序——这是「会话内顺序稳定」的落点。
 */
export function normalizeShuffleOrder(state: ShuffleState, queue: readonly Song[]): ShuffleState {
  const queueIds = new Set(queue.map((song) => song.id));
  const order: string[] = [];
  const kept = new Set<string>();
  for (const id of state.order) {
    if (queueIds.has(id) && !kept.has(id)) {
      order.push(id);
      kept.add(id);
    }
  }
  for (const song of queue) {
    if (!kept.has(song.id)) {
      order.push(song.id);
      kept.add(song.id);
    }
  }
  const anchoredId = itemAt(state.order, state.cursor);
  return { order, cursor: anchoredId ? order.indexOf(anchoredId) : -1 };
}

/**
 * 对齐成员并**把游标对到 `queue[currentIndex]` 这首歌**上。
 * 用在「播放定位到某首歌」「换队列」「进随机」之后，保证 next/prev 从正确位置出发。
 */
export function syncShuffleCursor(
  state: ShuffleState,
  queue: readonly Song[],
  currentIndex: number,
): ShuffleState {
  const normalized = normalizeShuffleOrder(state, queue);
  const currentId = songIdAt(queue, currentIndex);
  return { order: normalized.order, cursor: currentId ? normalized.order.indexOf(currentId) : -1 };
}

/**
 * 游标推进一格（dir = 1 下一首 / -1 上一首），回绕。
 * 游标越界（持久化数据损坏等）一律当作 -1 处理：next 从序列开头起、prev 从末尾起。
 * 单元素序列两个方向都归位到该曲（与既有「队列 ≤ 1 归位」行为一致）。
 */
export function stepShuffle(
  state: ShuffleState,
  queue: readonly Song[],
  direction: 1 | -1,
): ShuffleStep {
  const normalized = normalizeShuffleOrder(state, queue);
  const total = normalized.order.length;
  if (total === 0 || queue.length === 0) {
    return { index: -1, state: normalized };
  }
  const from = normalized.cursor;
  const nextCursor =
    from < 0 || from >= total
      ? direction === 1
        ? 0
        : total - 1
      : (from + direction + total) % total;
  const id = normalized.order[nextCursor];
  const index = queue.findIndex((song) => song.id === id);
  return { index, state: { order: normalized.order, cursor: index === -1 ? from : nextCursor } };
}

/**
 * 「下一首播放」在随机序里的落点：把 `songId` 放到`当前曲`的**下一格**。
 * - **先归一**（与其他导出函数同口径）：成员对齐成 `queue` 的一个排列，游标对到当前曲；
 *   否则传入残缺 order 时会把新 id 插进非全排列，落盘的序列就不守恒；
 * - 已在序列里 → 移动（不复制），幂等（已在目标格则原样返回）；
 * - 不在序列里 → 插入。**前置条件：`songId` 已在 `queue` 里**（队列成员由调用方维护）；
 * - 点的是当前曲本身 → 无「下一格」可插，原样返回；
 * - 无当前曲（currentIndex 越界）→ 插到序列开头。
 * 游标始终重算为「当前曲在新序列中的位置」，移动导致的整体平移不会算错。
 */
export function insertNextInShuffle(
  state: ShuffleState,
  queue: readonly Song[],
  songId: string,
  currentIndex: number,
): ShuffleState {
  const normalized = normalizeShuffleOrder(state, queue);
  const currentId = songIdAt(queue, currentIndex);
  const base: ShuffleState = {
    order: normalized.order,
    cursor: currentId ? normalized.order.indexOf(currentId) : -1,
  };
  if (currentId && songId === currentId) return base;

  const anchor = currentId ? base.order.indexOf(currentId) : -1;
  const existing = base.order.indexOf(songId);
  if (existing !== -1 && existing === anchor + 1) return base; // 幂等：已在「当前曲下一格」

  const order = [...base.order];
  if (existing !== -1) order.splice(existing, 1);
  // 摘除源条目后锚点可能左移，按「当前曲在新序列中的位置」重算
  const at = currentId ? order.indexOf(currentId) + 1 : 0;
  order.splice(Math.max(0, Math.min(at, order.length)), 0, songId);
  return { order, cursor: currentId ? order.indexOf(currentId) : -1 };
}

/** 队列内原位换源：把序列里的 `fromId` 就地换成 `toId`（同一格、顺序不变）。 */
export function replaceShuffleSongId(state: ShuffleState, fromId: string, toId: string): ShuffleState {
  if (fromId === toId || !state.order.includes(fromId)) return state;
  const order = state.order.map((id) => (id === fromId ? toId : id));
  return { order, cursor: state.cursor };
}

/**
 * 按随机序重排队列（**纯展示/取窗用**，不改成员）：不在序列里的歌按原队列顺序补在末尾，
 * 保证返回值与 `queue` 等长。队列页据此显示随机序，移动端据此切预取窗口。
 */
export function applyShuffleOrder(
  queue: readonly Song[],
  state: ShuffleState | null | undefined,
): Song[] {
  if (!state || state.order.length === 0) return [...queue];
  const byId = new Map(queue.map((song) => [song.id, song]));
  const ordered: Song[] = [];
  const seen = new Set<string>();
  for (const id of state.order) {
    const song = byId.get(id);
    if (song && !seen.has(id)) {
      ordered.push(song);
      seen.add(id);
    }
  }
  for (const song of queue) {
    if (!seen.has(song.id)) ordered.push(song);
  }
  return ordered;
}

/** 取 `list[index]` 的 id；下标非法返回 null（数组越界一律走这条，不抛）。 */
function itemAt<T>(list: readonly T[], index: number): T | null {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  return list[index];
}

/** 取 queue[index] 的歌曲 id；下标非法返回 null。 */
function songIdAt(list: readonly Song[], index: number): string | null {
  return itemAt(list, index)?.id ?? null;
}
