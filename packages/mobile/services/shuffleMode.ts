import AsyncStorage from '@react-native-async-storage/async-storage';
import { createShuffleState, syncShuffleCursor } from '@mplayer/core';
import type { ShuffleState, Song } from '@mplayer/core';

/**
 * 随机播放的**移动端接线**（#519 = #511 方案 A 的移动端消费 / #520 评审修订）。
 *
 * 语义唯一来源是 core `utils/shuffleOrder.ts`（洗牌序 + 游标的纯函数），
 * 契约见 ADR `docs/adr/2026-09-30-stable-shuffle-order.md` 的「移动端消费契约」。
 * 这里放移动端自己的东西：
 * ① **落盘 / 恢复**：`{ order, cursor }` 本身就是存储形态，直接 JSON 进 AsyncStorage；
 * ② **展示序**：队列页随机模式按序列展示，其它模式仍是成员序；
 * ③ **对齐的作用域**（#520 blocker 1，这条最容易写错）：
 *    - **窗口态**（对账 / 冷启 hydrate / 逐曲游标同步）：JS 队列可能只是原生**预取窗口**，
 *      所以只能`alignShuffleForWindow`（**只补不丢**）。这里若跑全量 normalize，窗口外的 id
 *      会被删掉，而 store 订阅会立刻落盘 ⇒ 随机序**永久截断**（评审实测 12 首 → 5 首）；
 *    - **权威态**（`setQueue` 拿到整张歌单）：队列是完整成员集，才允许
 *      `alignShuffleForMembers`（裁剪幽灵 id + 补新成员）。**幽灵 id 的唯一清理时机就是这里**
 *      —— 否则「只补不丢」会把截断 bug 换成膨胀 bug。
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
 * 序列是否**覆盖**这批歌：每个队列 id 都能在序列里找到。
 *
 * 序列允许有多余的 id（窗口态只补不丢留下的、或已从歌单移除的幽灵 id）——
 * 用「队列 id ⊆ 序列 id」判对齐，才对得上移动端「原生只持预取窗口」的模型
 * （#520 评审：原先用「id 集合相等」，窗口一来就判成"换歌单"→ 重洗）。
 */
export function orderCoversQueue(order: readonly string[], queue: readonly Song[]): boolean {
  const inOrder = new Set(order);
  return queue.every((song) => !!song.id && inOrder.has(song.id));
}

/**
 * **窗口态**对齐（只补不丢）：保留既有顺序，把队列里新出现的 id 追加到末尾，
 * 并把游标对到 `queue[currentIndex]`。窗口是整张歌单的子集时，序列**原样保留**。
 */
export function alignShuffleForWindow(
  state: ShuffleState,
  queue: Song[],
  currentIndex: number,
): ShuffleState {
  const seen = new Set(state.order);
  const order = [...state.order];
  for (const song of queue) {
    if (song.id && !seen.has(song.id)) {
      order.push(song.id);
      seen.add(song.id);
    }
  }
  const currentId = queue[currentIndex]?.id;
  return { order, cursor: currentId ? order.indexOf(currentId) : -1 };
}

/**
 * **权威态**对齐（`setQueue` 的完整歌单）：裁剪幽灵 id + 补齐新成员 + 对游标。
 * 相对顺序不变（core `syncShuffleCursor` = normalize + 定位），新成员追加在末尾。
 */
export function alignShuffleForMembers(
  state: ShuffleState,
  queue: Song[],
  currentIndex: number,
): ShuffleState {
  return syncShuffleCursor(state, queue, currentIndex);
}

/**
 * 建/对齐序列：
 * - 已有序列且**覆盖**这批歌（窗口、子集、同批）→ 窗口态只补不丢（不重洗、不裁剪）；
 * - 队列里出现了序列没有的歌（整批换队列 / 新歌单）→ 按 ADR 重洗一份；
 * - 队列里有歌缺 id 时返回 null：id 序列放不下无身份的歌，调用方退回顺序路径。
 */
export function ensureShuffleFor(
  queue: Song[],
  currentIndex: number,
  existing: ShuffleState | null,
): ShuffleState | null {
  if (!canShuffle(queue)) return null;
  if (!existing) return createShuffleState(queue, { currentIndex });
  if (orderCoversQueue(existing.order, queue)) {
    return alignShuffleForWindow(existing, queue, currentIndex);
  }
  return createShuffleState(queue, { currentIndex });
}

/**
 * 随机模式下的**展示用成员下标**：按序列取成员下标（同一 id 出现多次时按出现顺序 FIFO 匹配，
 * **不去重**——core `applyShuffleOrder` 是按 id 建 Map 的，重复 id 的队列会少行、标题对不上）。
 * 序列里没有的成员（新加的歌 / 无 id 的歌）按成员序补在末尾，保证返回值与队列**等长**。
 */
export function shuffleDisplayIndexes(order: readonly string[], queue: readonly Song[]): number[] {
  const byId = new Map<string, number[]>();
  queue.forEach((song, index) => {
    const list = byId.get(song.id);
    if (list) list.push(index);
    else byId.set(song.id, [index]);
  });
  const used = new Set<number>();
  const indexes: number[] = [];
  for (const id of order) {
    const at = byId.get(id)?.find((index) => !used.has(index));
    if (at == null) continue;
    used.add(at);
    indexes.push(at);
  }
  for (let index = 0; index < queue.length; index += 1) {
    if (!used.has(index)) indexes.push(index);
  }
  return indexes;
}

/** 队列页 / 取窗用的展示序：随机模式按序列（按成员下标映射，等长），其它模式仍是成员序。 */
export function selectQueueSongs(
  queue: Song[],
  playMode: string,
  shuffle: ShuffleState | null,
): Song[] {
  if (playMode !== '随机播放' || !shuffle || shuffle.order.length === 0) return queue;
  const indexes = shuffleDisplayIndexes(shuffle.order, queue);
  return indexes.length === queue.length ? indexes.map((index) => queue[index]) : queue;
}

/**
 * 从盘上读回随机序（缺省 / 损坏 / 形状不对 → null，绝不抛）。
 *
 * `cursor` 必须是 **[-1, order.length) 内的整数**：损坏值（如 0.5）会被 core 当成「尚无当前曲」，
 * 于是 `next()` 落到序列首——若序列首恰好是当前曲，用户看到的就是**点了下一首却没换歌**
 * （正是 #519 要修的症状）。所以这里直接夹取成 -1。
 */
export async function loadShuffleState(): Promise<ShuffleState | null> {
  try {
    const raw = await AsyncStorage.getItem(SHUFFLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShuffleState> | null;
    if (!parsed || !Array.isArray(parsed.order)) return null;
    const order = parsed.order.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (order.length === 0) return null;
    const rawCursor = parsed.cursor;
    const cursor =
      typeof rawCursor === 'number' &&
      Number.isInteger(rawCursor) &&
      rawCursor >= -1 &&
      rawCursor < order.length
        ? rawCursor
        : -1;
    return { order, cursor };
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
