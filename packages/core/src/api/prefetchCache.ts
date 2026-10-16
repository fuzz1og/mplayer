import type { PlayableResource, Song } from '../types/index.js';
import { identityKey } from '../utils/songIdentity.js';

/**
 * 预取 URL 缓存。
 * #391：批量探测链（probeSongsBatch / rememberProbeResult）已删除——它把「直连拿不到 URL」判成失效
 * （而多数歌靠 tier3 才可播），且产物无消费者。
 */

export const PREFETCH_TTL_MS = 30 * 60 * 1000;
const PREFETCH_CACHE_MAX = 500;
const prefetchCache = new Map<string, PlayableResource>();

/** 写入预取缓存；非 http 直链直接忽略。 */
export function setPrefetchedUrl(song: Song, url: string, nonFull: boolean): void {
  if (!url.startsWith('http')) return;
  if (prefetchCache.size >= PREFETCH_CACHE_MAX) prefetchCache.clear();
  prefetchCache.set(identityKey(song), { url, nonFull, ts: Date.now() });
}

/**
 * 读取预取缓存；过期条目按未命中处理并顺手清理。
 * #557 的教训：不要为了迁就某个端口而加宽它——该修的是那个端口。
 */
export function getPrefetchedUrl(song: Song): { url: string; nonFull: boolean } | undefined {
  const key = identityKey(song);
  const entry = prefetchCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts >= PREFETCH_TTL_MS) {
    prefetchCache.delete(key);
    return undefined;
  }
  return { url: entry.url, nonFull: entry.nonFull };
}

/** 遗忘单歌预取条目：播放失败 fresh 重试前调用，避免重走路由解析时
 *  0 等待命中刚被证明失败的预取直链（同一条死链接连败两次）。 */
export function forgetPrefetchedUrl(song: Song): void {
  prefetchCache.delete(identityKey(song));
}

/** 测试/重置用：清空全部预取条目。 */
export function clearPrefetchCache(): void {
  prefetchCache.clear();
}
