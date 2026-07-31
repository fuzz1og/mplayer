import { useState, useEffect } from 'react';
import { IpcClient } from './IpcClient';

const inFlight = new Set<string>();

export async function getCoverSrc(coverUrl: string): Promise<string> {
  if (!coverUrl || coverUrl.startsWith('file://')) return coverUrl;
  const cachedPath = await IpcClient.invoke<string | null>('cache:getCover', coverUrl);
  if (cachedPath) return 'file://' + cachedPath;
  cacheCoverImage(coverUrl);
  return coverUrl;
}

export async function cacheCoverImage(coverUrl: string): Promise<void> {
  if (!coverUrl || coverUrl.startsWith('file://')) return;
  // 仅允许 http/https 协议，防止 file:// 等协议读取本地文件
  try {
    const parsed = new URL(coverUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  } catch {
    return;
  }
  if (inFlight.has(coverUrl)) return;
  inFlight.add(coverUrl);
  try {
    const response = await fetch(coverUrl);
    if (!response.ok) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    await IpcClient.invoke<void>('cache:setCover', coverUrl, buffer);
  } catch (error) {
    console.error('缓存封面失败:', error);
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
