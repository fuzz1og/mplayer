import { useState, useEffect } from 'react';
import { IpcClient } from './IpcClient';

const inFlight = new Set<string>();

function isValidCoverUrl(coverUrl: string): boolean {
  if (!coverUrl || coverUrl.startsWith('file://')) return false;
  try {
    const parsed = new URL(coverUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// 校验响应内容是真实图片（JPEG/PNG/WebP/GIF）：默认图/错误页/反爬页等非图片内容绝不入缓存
function isImageContent(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
  return false;
}

export async function getCoverSrc(coverUrl: string): Promise<string> {
  if (!coverUrl || coverUrl.startsWith('file://')) return coverUrl;
  const cachedPath = await IpcClient.invoke<string | null>('cache:getCover', coverUrl);
  if (cachedPath) return 'file://' + cachedPath;
  cacheCoverImage(coverUrl);
  return coverUrl;
}

export async function cacheCoverImage(coverUrl: string): Promise<void> {
  if (!isValidCoverUrl(coverUrl)) return;
  if (inFlight.has(coverUrl)) return;
  inFlight.add(coverUrl);
  try {
    const response = await fetch(coverUrl);
    if (!response.ok) return;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!isImageContent(bytes)) return;
    await IpcClient.invoke<void>('cache:setCover', coverUrl, Buffer.from(bytes));
  } catch (error) {
    console.error('缓存封面失败:', error);
  } finally {
    inFlight.delete(coverUrl);
  }
}

/**
 * 解析一次封面地址。封面加载失败后的"换新 URL"由页面层处理：
 * 持有 song 的地方在 img onError 时调用 refreshSongCover（按 ID 重识别），
 * 更新 song.cover 后本 hook 随 coverUrl 变化自动重新解析。
 */
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
