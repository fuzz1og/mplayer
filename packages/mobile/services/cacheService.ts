import {
  CacheKernel,
  createMemoryBackend,
  identityKey,
  SongResourcesCache,
  SONGS_TTL_MS,
} from '@mplayer/core';
import type { PlayableResource, Song } from '@mplayer/core';
import { MobileFileBackend } from '../cache/fileBackend';

// L1 内存 + L2 文件（expo cacheDirectory）双层缓存；设置页可查看统计并一键清理（对齐桌面 CacheSection）。
const fileBackend = new MobileFileBackend();
const kernel = new CacheKernel({
  l1: createMemoryBackend(),
  l2: fileBackend,
});

/**
 * 歌曲资源语义层（ADR-0002）：key/TTL 推导内聚，调用方不手拼。
 * 播放资源值（ADR-0012）走 song:<身份键>——身份键 = 音乐源 + 去源前缀真实 ID
 * （utils/songIdentity，多层嵌套前缀按最外层源折叠），同一 rawId 不同源不再串直链。
 * key 前缀（song:）留在语义层，调用方只传身份键。
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
 * 归一历史条目（老用户缓存不失效）：
 * - 旧版纯字符串 url → { url, nonFull:false, ts:0 }（ts=0 视为高龄，播放前探活）；
 * - 旧版三件套 { url, cover, lrc } / 早期 { url, ts } → 补 nonFull:false、ts 缺失按 0。
 * 无 http url 一律 null（走重新解析）。
 */
function normalizePlayableResource(raw: unknown): PlayableResource | null {
  if (typeof raw === 'string') {
    return raw.startsWith('http') ? { url: raw, nonFull: false, ts: 0 } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { url?: unknown; nonFull?: unknown; ts?: unknown };
  if (typeof value.url !== 'string' || !value.url.startsWith('http')) return null;
  return {
    url: value.url,
    nonFull: value.nonFull === true,
    ts: typeof value.ts === 'number' ? value.ts : 0,
  };
}

/**
 * 读取播放资源值（语义层 key，TTL 12h 过期自动失效）。未命中/无 http url → null。
 * 保留 nonFull：预取/解析命中试听版时播放侧必须走「试听版」分支。
 */
export async function getCachedResource(song: Song): Promise<PlayableResource | null> {
  if (!song?.id) return null;
  const raw = await cacheKernel.getJSON<unknown>(songResources.songKey(identityKey(song)));
  return normalizePlayableResource(raw);
}

/** 写入播放资源值（nonFull 原样保留；url 非 http 不写）。 */
export async function setCachedResource(song: Song, resource: PlayableResource): Promise<void> {
  if (!song?.id || !resource?.url?.startsWith('http')) return;
  const ts = resource.ts > 0 ? resource.ts : Date.now();
  const value: PlayableResource = { url: resource.url, nonFull: resource.nonFull === true, ts };
  await cacheKernel.setJSON(songResources.songKey(identityKey(song)), value, SONGS_TTL_MS);
  urlWrittenAt.set(identityKey(song), ts);
}

/**
 * 失效单首歌的资源值（播放失败时调用）。
 * CDN 直链带时效签名（kuwo 等），12h TTL 内签名就会过期——死链若不清，
 * 每次播放都抢先命中同一个坏地址（真机复现：《恋人》隔 3 小时重播必失败）。
 * 走语义层 key 推导，调用方不手拼（ADR-0002）。
 */
export async function deleteCachedResource(song: Song): Promise<void> {
  if (!song?.id) return;
  await cacheKernel.remove(songResources.songKey(identityKey(song)));
  urlWrittenAt.delete(identityKey(song));
}

/** 缓存 URL 的年龄（ms）；从未写入（重启/未预取过）返回 null。 */
export function urlAgeMs(song: Song): number | null {
  const t = urlWrittenAt.get(identityKey(song));
  return t == null ? null : Date.now() - t;
}
