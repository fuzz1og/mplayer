import { CacheKernel, createMemoryBackend, SongResourcesCache } from '@mplayer/core';
import { MobileFileBackend } from '../cache/fileBackend';

// L1 内存 + L2 文件（expo cacheDirectory）双层缓存；设置页可查看统计并一键清理（对齐桌面 CacheSection）。
const fileBackend = new MobileFileBackend();
const kernel = new CacheKernel({
  l1: createMemoryBackend(),
  l2: fileBackend,
});

/**
 * 歌曲资源语义层（ADR-0002）：key/TTL 推导内聚，调用方不手拼。
 * 播放 URL 缓存走 song:<songId>（songId 含源前缀，跨源唯一）；
 * 移动端并入语义层后 key 去掉冗余 sourceType 前缀，变化一次无害冷缓存。
 */
export const songResources = new SongResourcesCache({ kernel });

export const cacheKernel = kernel;

/** 磁盘缓存占用统计（设置页展示） */
export async function getCacheStats(): Promise<{ fileCount: number; totalSize: number }> {
  return fileBackend.getDiskStats();
}

// URL 写入时间（内存 Map，重启丢失→视为高龄）：签名直链服务端寿命
// ~15-30min，条目「年轻」时播放前免探活（0 额外延迟）、后台预取跳过重解析；
// 高龄条目播放前先探活，死链直接重解析而不是交给播放器死等 ~3s。
const urlWrittenAt = new Map<string, number>();

/**
 * 读取播放 URL 缓存（走语义层，TTL 12h 过期自动失效）。无 http url 返回 null（重新解析）。
 */
export async function getCachedUrl(songId: string): Promise<string | null> {
  if (!songId) return null;
  const res = await songResources.getSongResources(songId);
  if (!res?.url?.startsWith('http')) return null;
  return res.url;
}

/** 写入歌曲资源（三元组存 url，cover/lrc 留空；由语义层 kernel 管控 TTL）。 */
export async function setCachedUrl(songId: string, url: string): Promise<void> {
  if (!songId || !url.startsWith('http')) return;
  await songResources.setSongResources(songId, { url, cover: '', lrc: '' });
  urlWrittenAt.set(songId, Date.now());
}

/**
 * 失效单首歌的 URL 缓存（播放失败时调用）。
 * CDN 直链带时效签名（kuwo 等），12h TTL 内签名就会过期——死链若不清，
 * 每次播放都抢先命中同一个坏地址（真机复现：《恋人》隔 3 小时重播必失败）。
 */
export async function deleteCachedUrl(songId: string): Promise<void> {
  if (!songId) return;
  await cacheKernel.remove(songResources.songKey(songId));
  urlWrittenAt.delete(songId);
}

/** 缓存 URL 的年龄（ms）；从未写入（重启/未预取过）返回 null。 */
export function urlAgeMs(songId: string): number | null {
  const t = urlWrittenAt.get(songId);
  return t == null ? null : Date.now() - t;
}
