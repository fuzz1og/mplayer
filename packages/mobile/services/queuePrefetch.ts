import { getNextSongIndex } from '@mplayer/core';
import type { Song } from '@mplayer/core';

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
 */
export function planNextIndexes(
  queue: Song[],
  fromIndex: number,
  count: number,
  excluded: Set<string>,
  playMode: string
): number[] {
  if (queue.length === 0 || count <= 0) return [];
  const planned: number[] = [];
  const localExcluded = new Set(excluded);
  let cursor = fromIndex;

  while (planned.length < count) {
    let next: number;
    if (playMode === '随机播放' && queue.length > 1) {
      next = getNextSongIndex(queue, cursor, '随机播放');
      let guard = 0;
      while ((next < 0 || next === cursor || localExcluded.has(prefetchKey(queue[next]))) && guard < queue.length * 2) {
        next = Math.floor(Math.random() * queue.length);
        if (next === cursor) next = (next + 1) % queue.length;
        guard += 1;
      }
      if (next < 0 || next === cursor || localExcluded.has(prefetchKey(queue[next]))) {
        // 随机取不到新项（队列太小 / 全在窗口里）→ 退化为顺序，保证窗口仍能被填满
        next = cursor + 1;
      }
    } else {
      next = cursor + 1;
    }

    if (next < 0 || next >= queue.length) break;
    if (localExcluded.has(prefetchKey(queue[next]))) {
      cursor = next;
      if (playMode !== '随机播放' && next >= queue.length - 1) break;
      continue;
    }
    localExcluded.add(prefetchKey(queue[next]));
    planned.push(next);
    cursor = next;
    if (playMode === '随机播放' && planned.length >= queue.length - 1) break;
  }

  return planned;
}
