import { useEffect, useState } from 'react';
import { musicApi, isSessionProtectedEndpoint } from '@mplayer/core';

/**
 * 封面 URL 解析 Hook。
 * 封面端点是 api.php?get=pic（需要 PHPSESSID 会话 cookie），
 * 移动端原生 <Image> 无法携带 cookie，直接加载会得到「非法请求」页 → 占位图。
 * 这里在 JS 层把 api.php 封面解析成 CDN 直链（core 内有 30 分钟 TTL 缓存），
 * 原生 <Image> 即可直接加载；非 api.php URL 或解析失败原样返回，
 * 由调用方的 onError 占位图逻辑兜底。
 */
export function useResolvedCover(coverUrl?: string): string {
  // 首帧就跳过保护端点（解析完成前渲染必失败，onError 会抢占解析结果）
  const [resolved, setResolved] = useState<string>(() =>
    coverUrl && !isSessionProtectedEndpoint(coverUrl) ? coverUrl : ''
  );

  useEffect(() => {
    let cancelled = false;
    const url = coverUrl || '';
    if (!isSessionProtectedEndpoint(url)) {
      setResolved(url);
      return;
    }
    // 会话保护端点先渲染必失败（无 cookie），解析完成前返回空串让占位图兜底，
    // 避免 onError 抢占解析结果（否则 CDN 直链到达时封面已被标记失败）
    setResolved('');
    musicApi
      .resolveCoverUrl(url)
      .then((r) => {
        if (!cancelled) setResolved(r);
      })
      .catch(() => {
        // 解析失败回退原 URL，交给 Image onError 占位图兜底（保留既有兜底行为）
        if (!cancelled) setResolved(url);
      });
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return resolved;
}
