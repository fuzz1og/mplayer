import type { PlayableResource, Song } from '../types/index.js';
import { identityKey } from '../utils/songIdentity.js';

/**
 * 预取 URL 缓存。
 *
 * 写入方 = core 门面 `prefetchPlayableSong`（#390：桌面经 `musicApi:call` 在**主进程**
 * 执行，写的正是播放解析读的那一份）；读取方 = `resolvePlayableSongRouted` 的
 * 0 等待命中；失败遗忘 = `forgetPrefetchedSong`（fresh 重试前）。
 *
 * - 键 = 歌曲身份键（utils/songIdentity：源 + 去前缀真实 ID，多层嵌套前缀按最外层源
 *   折叠）——同 id 不同源是不同版本，不能串；裸 id（直连搜索）与带前缀 id（换源后）
 *   收敛为同一键，等价 id 共享条目（预期行为，旧裸键靠各层 TTL 自净）；
 * - 条目 = PlayableResource（types/index）：url + nonFull + ts（写入时间）；
 * - TTL 30min：第三方间歇性失效/URL 过期后不会永久命中坏链接；
 * - 拿不到 URL（无版权/VIP/全链失败）不写入；preview 缓存但带 nonFull=true，
 *   播放秒出声的同时驱动「试听版 + 换源」提示。
 *
 * #391：批量探测链（probeSongsBatch / rememberProbeResult）已删除——它把「直连拿不到
 * URL」判成失效（而多数歌靠 tier3 才可播），且产物无消费者。预解析改由「队列下一首
 * 预取 / 冷启预热」承担（经 `prefetchPlayableSong`，含 tier3 兜底、覆盖 100%）。
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

/** 读取预取缓存；过期条目按未命中处理并顺手清理。 */
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
