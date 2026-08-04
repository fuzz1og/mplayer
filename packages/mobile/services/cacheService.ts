import { CacheKernel, createMemoryBackend } from '@mplayer/core';
import { MobileFileBackend } from '../cache/fileBackend';

// 播放 URL 缓存 TTL：24h（音乐源直链一般数小时失效，过期自动失效不再复用）
const URL_TTL = 24 * 60 * 60 * 1000;

// L1 内存 + L2 文件（expo cacheDirectory）双层缓存；
// 设置页可查看统计并一键清理（对齐桌面 CacheSection）
const fileBackend = new MobileFileBackend();
export const cacheKernel = new CacheKernel({
  l1: createMemoryBackend(),
  l2: fileBackend,
});

/** 磁盘缓存占用统计（设置页展示） */
export async function getCacheStats(): Promise<{ fileCount: number; totalSize: number }> {
  return fileBackend.getDiskStats();
}

interface CachedUrl { url: string; ts: number }

/** 播放 URL 缓存 key：来源前缀隔离——不同来源同名歌曲（不同 id）不互相覆盖 */
function urlCacheKey(songId: string, sourceType: string): string {
  return `url:${sourceType}:${songId}`;
}

/**
 * 读取播放 URL 缓存（带 TTL 过期检查，过期删除）。
 * 无 id / 非 http / 过期都返回 null（走重新解析）。
 */
export async function getCachedUrl(songId: string, sourceType: string): Promise<string | null> {
  if (!songId) return null;
  const key = urlCacheKey(songId, sourceType);
  const v = await cacheKernel.getJSON<CachedUrl>(key);
  if (!v?.url?.startsWith('http')) return null;
  if (Date.now() - v.ts > URL_TTL) {
    await cacheKernel.remove(key);
    return null;
  }
  return v.url;
}

/** 写入播放 URL 缓存（带时间戳用于 TTL 判断）。 */
export async function setCachedUrl(songId: string, sourceType: string, url: string): Promise<void> {
  if (!songId || !url.startsWith('http')) return;
  await cacheKernel.setJSON(urlCacheKey(songId, sourceType), { url, ts: Date.now() } satisfies CachedUrl, URL_TTL);
}
