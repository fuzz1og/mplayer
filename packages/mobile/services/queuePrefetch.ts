import { applyShuffleOrder, getNextSongIndex } from '@mplayer/core';
import type { ShuffleState, Song } from '@mplayer/core';

/**
 * 预取窗口的状态与定序（规格 §5.5 / §7.3）。
 *
 * 只做两件事，都是纯逻辑（不碰原生、不发请求），便于单测：
 * 1. **三层预取去重**（沿用 PR #433 的常量与语义）：
 *    - 在飞去重 `inFlight`：同一首不并发解析；
 *    - 成功窗口 `PREFETCH_SKIP_FRESH_MS`：5min 内已成功的 key 不重复解析
 *      （与既有的 12h 资源缓存叠加，避免重复烧整条 tier3 链）；
 *    - 失败冷却 `PREFETCH_FAIL_COOLDOWN_MS`：失败后 30s 内不再重烧整条解析链。
 * 2. **窗口定序**：顺序模式取 index+1、+2…；随机模式由 JS 按 core 规则定序
 *    （`getNextSongIndex`，每次随机且 ≠ 当前），原生只顺序推进
 *    —— 这样预取窗口天然知道下一首是谁，锁屏 next 与 UI next 语义一致。
 */

export const PREFETCH_SKIP_FRESH_MS = 5 * 60 * 1000;
export const PREFETCH_FAIL_COOLDOWN_MS = 30 * 1000;
/** 剩余 ≤ 15s 时补一次窗口（降低踩空概率的优化；原生推进已接管保命职责） */
export const PREFETCH_LEAD_SEC = 15;

const inFlight = new Set<string>();
const succeededAt = new Map<string, number>();
const failedAt = new Map<string, number>();

/** core `Song` 的稳定标识（id 优先，退化到 name|artist） */
export function prefetchKey(song: Song): string {
  return song.id || `${song.name}|${song.artist ?? ''}`;
}

export function isInFlight(key: string): boolean {
  return inFlight.has(key);
}

export function beginResolve(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function endResolve(key: string): void {
  inFlight.delete(key);
}

export function isFresh(key: string, now: number = Date.now()): boolean {
  const at = succeededAt.get(key);
  return at != null && now - at < PREFETCH_SKIP_FRESH_MS;
}

export function isCoolingDown(key: string, now: number = Date.now()): boolean {
  const at = failedAt.get(key);
  return at != null && now - at < PREFETCH_FAIL_COOLDOWN_MS;
}

export function markSucceeded(key: string, now: number = Date.now()): void {
  succeededAt.set(key, now);
  failedAt.delete(key);
}

export function markFailed(key: string, now: number = Date.now()): void {
  failedAt.set(key, now);
}

/** 测试用：清空全部去重状态 */
export function resetPrefetchState(): void {
  inFlight.clear();
  succeededAt.clear();
  failedAt.clear();
}

/**
 * 计划「接下来 count 个待播 index」。
 *
 * @param excluded 已在原生手里的 key（`nativeMirror`）——不重复投喂
 * @param playMode settingsStore 的播放模式（'单曲循环' | '随机播放' | '列表循环'）
 * @param shuffle 稳定随机序列（#519）；随机模式下**有序列就按序列定序**，不再现抽
 */
export function planNextIndexes(
  queue: Song[],
  fromIndex: number,
  count: number,
  excluded: Set<string>,
  playMode: string,
  shuffle?: ShuffleState | null
): number[] {
  if (queue.length === 0 || count <= 0) return [];
  // 单曲循环由原生 REPEAT_MODE_ONE 处理：不补窗（补了也永远不会播到）
  if (playMode === '单曲循环') return [];

  // 随机（#519）：定序交给 core 的**稳定序列**（游标推进），同一稳态下计划收敛为同一批。
  // 旧实现每轮 Math.random 重抽一批 → 「补窗 → patchQueue → 状态变化 → 再补窗」自激循环：
  // 原生窗口每轮被换成完全不同的一批歌，下一首永远等不到（真机 9 分钟 0 次换歌）。
  if (playMode === '随机播放' && shuffle && queue.length > 1) {
    const ordered = applyShuffleOrder(queue, shuffle);
    const currentSong = queue[fromIndex];
    const at = ordered.findIndex((s) => s === currentSong || (!!s.id && s.id === currentSong?.id));
    // 当前曲不在序列里（id 缺失等）→ 当作「在序列起点之前」，从序列开头取
    const anchor = at >= 0 ? at : ordered.length - 1;
    const local = new Set(excluded);
    const byOrder: number[] = [];
    for (let k = 1; k <= ordered.length && byOrder.length < count; k += 1) {
      const candidate = ordered[(anchor + k) % ordered.length];
      const key = prefetchKey(candidate);
      if (local.has(key)) continue;
      const memberIndex = queue.indexOf(candidate);
      if (memberIndex < 0) continue;
      local.add(key);
      byOrder.push(memberIndex);
    }
    return byOrder;
  }

  const planned: number[] = [];
  const localExcluded = new Set(excluded);
  let cursor = fromIndex;
  let guard = 0;
  // 上限：最多绕队列两圈找候选（excluded 命中时只跳过，不无限自旋）
  const maxIter = queue.length * 2 + 6;

  while (planned.length < count && guard < maxIter) {
    guard += 1;
    let next: number;

    if (playMode === '随机播放' && queue.length > 1) {
      next = getNextSongIndex(queue, cursor, '随机播放');
      let inner = 0;
      while (
        (next < 0 || next === cursor || localExcluded.has(prefetchKey(queue[next]))) &&
        inner < queue.length * 2
      ) {
        next = Math.floor(Math.random() * queue.length);
        if (next === cursor) next = (next + 1) % queue.length;
        inner += 1;
      }
      if (next < 0 || next === cursor || localExcluded.has(prefetchKey(queue[next]))) {
        next = (cursor + 1) % queue.length;
      }
    } else {
      // 列表循环：走到底就绕回 JS 队列头部（原生 repeatMode 恒 OFF，绕圈语义在 JS）
      next = cursor + 1;
      if (next >= queue.length) next = 0;
    }

    if (localExcluded.has(prefetchKey(queue[next]))) {
      // 已经在原生手里（或这一轮刚计划过）→ 跳过继续找，绝不返回重复项
      cursor = next;
      if (next === fromIndex) break;
      continue;
    }

    localExcluded.add(prefetchKey(queue[next]));
    planned.push(next);
    cursor = next;
  }

  return planned;
}
