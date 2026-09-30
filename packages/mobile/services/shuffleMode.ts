import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyShuffleOrder, createShuffleState, syncShuffleCursor } from '@mplayer/core';
import type { ShuffleState, Song } from '@mplayer/core';

/**
 * 随机播放的**移动端接线**（#519 = #511 方案 A 的移动端消费）。
 *
 * 语义唯一来源是 core `utils/shuffleOrder.ts`（洗牌序 + 游标的纯函数），
 * 契约见 ADR `docs/adr/2026-09-30-stable-shuffle-order.md` 的「移动端消费契约」。
 * 这里只放移动端自己的三件事：
 * ① **落盘 / 恢复**：`{ order, cursor }` 本身就是存储形态，直接 JSON 进 AsyncStorage；
 * ② **展示序**：队列页随机模式按序列展示（用户明确要求「队列要让用户也能看到那个随机」），
 *    其它模式仍是成员序；
 * ③ **该不该重洗的判定**：同一批歌（封面回填 / 同列表再点播）只做增量对齐，**不重洗**。
 */

export const SHUFFLE_STORAGE_KEY = 'mplayer.shuffle.v1';

/** 队列里每首歌都有 id，才能用 id 建序列（core 的序列以歌曲 id 为身份）。 */
export function canShuffle(queue: readonly Song[]): boolean {
  return queue.length > 0 && queue.every((song) => !!song.id);
}

/** 两份序列是否逐项相同（避免无变化也写 store / 落盘）。 */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * 序列是否**恰好覆盖**这批歌（id 集合一致）——用来区分「同一队列原地改」（封面回填、
 * 同列表再次点播）与「整批换队列」。队列里有重复 id 时按去重后的集合比较（序列是 id 排列）。
 */
export function orderMatchesQueue(order: readonly string[], queue: readonly Song[]): boolean {
  const queueIds = new Set(queue.map((song) => song.id));
  if (order.length !== queueIds.size) return false;
  return order.every((id) => queueIds.has(id));
}

/**
 * 建/对齐序列：
 * - 已有序列且仍覆盖这批歌 → 只把游标对到当前曲（**不重洗**，会话内顺序稳定）；
 * - 否则（首次进随机 / 换了歌单）→ 按当前队列洗一份新的。
 * 队列里有歌缺 id 时返回 null：id 序列放不下无身份的歌，调用方退回旧的顺序/现抽路径。
 */
export function ensureShuffleFor(
  queue: Song[],
  currentIndex: number,
  existing: ShuffleState | null,
): ShuffleState | null {
  if (!canShuffle(queue)) return null;
  if (existing && orderMatchesQueue(existing.order, queue)) {
    return syncShuffleCursor(existing, queue, currentIndex);
  }
  return createShuffleState(queue, { currentIndex });
}

/** 队列页 / 取窗用的展示序：随机模式按序列，其它模式（或还没序列）仍是成员序。 */
export function selectQueueSongs(
  queue: Song[],
  playMode: string,
  shuffle: ShuffleState | null,
): Song[] {
  if (playMode !== '随机播放' || !shuffle) return queue;
  return applyShuffleOrder(queue, shuffle);
}

/** 从盘上读回随机序（缺省 / 损坏 / 形状不对 → null，绝不抛）。 */
export async function loadShuffleState(): Promise<ShuffleState | null> {
  try {
    const raw = await AsyncStorage.getItem(SHUFFLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShuffleState> | null;
    if (!parsed || !Array.isArray(parsed.order) || typeof parsed.cursor !== 'number') return null;
    const order = parsed.order.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (order.length === 0) return null;
    return { order, cursor: parsed.cursor };
  } catch {
    return null;
  }
}

/**
 * 落盘（fire-and-forget）。调用方是**状态订阅**（playerStore 的 shuffle 变化），
 * 不能 await，也不能让写盘失败冒泡到播放路径。
 */
export function saveShuffleState(state: ShuffleState | null): void {
  const write = state
    ? AsyncStorage.setItem(SHUFFLE_STORAGE_KEY, JSON.stringify(state))
    : AsyncStorage.removeItem(SHUFFLE_STORAGE_KEY);
  void Promise.resolve(write).catch(() => {});
}
