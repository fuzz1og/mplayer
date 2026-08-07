import { IpcClient } from '@/renderer/services/IpcClient';
import { isSessionProtectedEndpoint } from '@mplayer/core';

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

  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.url);

  const running = inFlight.get(url);
  if (running) return running;

  const pending = IpcClient.invoke<string>('musicApi:resolveCoverUrl', url)
    .then((resolved) => {
      const final = resolved && resolved !== url && resolved.startsWith('http') ? resolved : url;
      if (final !== url) {
        cache.set(url, { url: final, expires: Date.now() + TTL });
      }
      return final;
    })
    .catch(() => url)
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, pending);
  return pending;
}

/** 测试专用：清空解析缓存，保证用例间隔离 */
export function __resetCoverUrlResolver(): void {
  cache.clear();
  inFlight.clear();
}
