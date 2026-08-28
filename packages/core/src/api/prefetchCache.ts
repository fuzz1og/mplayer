import type { AudioTag, Song } from '../types/index.js';

/**
 * 预取 URL 缓存（探测职责转型：打标签 → 预取 URL）。
 *
 * 探测（probeSongsBatch，直连-only）在给歌曲打可播性标签的同时，把解析出的
 * 直链 URL 写入本缓存；播放解析（resolvePlayableSongRouted）先查缓存，
 * 命中直接返回（0 等待），未命中才实时走完整解析链。
 *
 * - 键 = `sourceType:id`（同 id 不同源是不同版本，不能串）；
 * - TTL 30min：第三方间歇性失效/URL 过期后不会永久命中坏链接；
 * - 只存直连解析结果（探测只做直连，tier3 不预取）；
 * - invalid（直连死链）不缓存；preview 缓存但带 nonFull=true，播放秒出声
 *   的同时驱动「试听版 + 换源」提示。
 */

export interface PrefetchEntry {
  url: string;
  nonFull: boolean;
  ts: number;
}

export const PREFETCH_TTL_MS = 30 * 60 * 1000;
const PREFETCH_CACHE_MAX = 500;
const prefetchCache = new Map<string, PrefetchEntry>();

export function prefetchCacheKey(song: Song): string {
  return `${song.sourceType}:${song.id}`;
}

/** 写入预取缓存；非 http 直链直接忽略。 */
export function setPrefetchedUrl(song: Song, url: string, nonFull: boolean): void {
  if (!url.startsWith('http')) return;
  if (prefetchCache.size >= PREFETCH_CACHE_MAX) prefetchCache.clear();
  prefetchCache.set(prefetchCacheKey(song), { url, nonFull, ts: Date.now() });
}

/** 读取预取缓存；过期条目按未命中处理并顺手清理。 */
export function getPrefetchedUrl(song: Song): { url: string; nonFull: boolean } | undefined {
  const key = prefetchCacheKey(song);
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
  prefetchCache.delete(prefetchCacheKey(song));
}

/**
 * 探测结果写缓存：invalid / 空 URL 不缓存；preview 或直连权威判定 nonFull
 * 时缓存 nonFull=true（播放命中后立即提示试听版）。
 */
export function rememberProbeResult(
  song: Song,
  url: string,
  tag: AudioTag,
  nonFull = false,
): void {
  if (!url.startsWith('http') || tag === 'invalid') return;
  setPrefetchedUrl(song, url, tag === 'preview' || nonFull);
}

/** 测试/重置用：清空全部预取条目。 */
export function clearPrefetchCache(): void {
  prefetchCache.clear();
}
