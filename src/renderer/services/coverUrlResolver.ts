import { IpcClient } from '@/renderer/services/IpcClient';
import { isSessionProtectedEndpoint, resourceUrlKey } from '@mplayer/core';
import { callMusicApi } from '@/renderer/services/callMusicApi';

/**
 * 封面直链解析：会话保护的封面端点（api.php?get=pic，需 PHPSESSID cookie）
 * 渲染端 <img> 无法携带 cookie，统一在 JS 层解析成 CDN 直链后再渲染。
 * Promise 级去重（同一 URL 并发只发起一次）+ 6 小时 TTL 缓存；
 * 解析失败（会话未就绪等）不缓存，返回原 URL 交给 onError 占位图兜底。
 */

const TTL = 6 * 60 * 60 * 1000;
const cache = new Map<string, { url: string; expires: number }>();
const inFlight = new Map<string, Promise<string>>();

export function resolveCoverUrl(url: string): Promise<string> {
  if (!url || !isSessionProtectedEndpoint(url)) return Promise.resolve(url);

  // 缓存 key 用归一化 URL：同一首歌每次搜索返回不同签名（t/sign），
  // 但封面是同一资源——归一化后命中同一缓存，避免重复 IPC 解析
  const key = resourceUrlKey(url);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.url);

  const running = inFlight.get(key);
  if (running) return running;

  const pending = callMusicApi('resolveCoverUrl', url)
    .then((resolved) => {
      const final = resolved && resolved !== url && resolved.startsWith('http') ? resolved : url;
      if (final !== url) {
        cache.set(key, { url: final, expires: Date.now() + TTL });
      }
      return final;
    })
    .catch(() => url)
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, pending);
  return pending;
}

/**
 * 封面失效：清除本层解析缓存 + 主进程 6h 归一化缓存 + 磁盘封面缓存。
 * 归一化 key 命中失效直链会循环失败（签名换新但归一化 key 相同），
 * 必须在重搜/重解析前调用（对齐手机端 core invalidateCoverUrl 语义）。
 */
export function invalidateCoverUrl(url: string): void {
  if (!url) return;
  const key = resourceUrlKey(url);
  cache.delete(key);
  // 归一化前可能残留以完整 URL 为 key 的旧缓存项，一并清掉
  for (const k of cache.keys()) {
    if (resourceUrlKey(k) === key) cache.delete(k);
  }
  void callMusicApi('invalidateCoverUrl', url).catch(() => {});
  void IpcClient.invoke('cache:invalidateCover', url).catch(() => {});
}

/** 测试专用：清空解析缓存，保证用例间隔离 */
export function __resetCoverUrlResolver(): void {
  cache.clear();
  inFlight.clear();
}
