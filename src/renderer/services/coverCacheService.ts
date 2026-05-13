import { useState, useEffect } from 'react';
import { cacheService } from './cacheService';

const inFlight = new Set<string>();

export async function getCoverSrc(coverUrl: string): Promise<string> {
  if (!coverUrl || coverUrl.startsWith('file://')) return coverUrl;
  const cachedPath = await cacheService.getCoverCache(coverUrl);
  if (cachedPath) return 'file://' + cachedPath;
  cacheCoverImage(coverUrl);
  return coverUrl;
}

export async function cacheCoverImage(coverUrl: string): Promise<void> {
  if (!coverUrl || coverUrl.startsWith('file://')) return;
  if (inFlight.has(coverUrl)) return;
  inFlight.add(coverUrl);
  try {
    const response = await fetch(coverUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    await cacheService.setCoverCache(coverUrl, buffer);
  } catch {
    // 静默失败
  } finally {
    inFlight.delete(coverUrl);
  }
}

export function useCachedCover(coverUrl: string): string {
  const [src, setSrc] = useState(coverUrl);

  useEffect(() => {
    if (!coverUrl || coverUrl.startsWith('file://')) {
      setSrc(coverUrl);
      return;
    }
    let cancelled = false;
    getCoverSrc(coverUrl).then((resolved) => {
      if (!cancelled) setSrc(resolved);
    });
    return () => { cancelled = true; };
  }, [coverUrl]);

  return src;
}
