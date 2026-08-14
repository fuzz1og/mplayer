import { useState, useEffect } from 'react';
import { IpcClient } from './IpcClient';
import { isSessionProtectedEndpoint } from '@mplayer/core';

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

export async function getCoverSrc(coverUrl: string): Promise<string> {
  if (!coverUrl || coverUrl.startsWith('file://')) return coverUrl;
  let cachedPath: string | null = null;
  try {
    cachedPath = await IpcClient.invoke<string | null>('cache:getCoverPath', coverUrl);
  } catch (error) {
    console.error('读取封面缓存失败:', error);
  }
  if (cachedPath) return 'file://' + cachedPath;
  cacheCoverImage(coverUrl);
  return coverUrl;
}

export async function cacheCoverImage(coverUrl: string): Promise<void> {
  if (!isValidCoverUrl(coverUrl)) return;
  // 受保护封面端点需要会话 cookie，渲染层 fetch 永远拿不到图（服务端
  // 返回错误页）——自增会话强制后该路径已不可用，落盘缓存改由主进程
  // 在 resolveCoverUrl 时完成（见 main/ipc/cache.ts cacheResolvedCover）
  if (isSessionProtectedEndpoint(coverUrl)) return;
  if (inFlight.has(coverUrl)) return;
  inFlight.add(coverUrl);
  try {
    const response = await fetch(coverUrl);
    if (!response.ok) return;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // 字节校验（非图片内容拒绝入缓存）移入主进程语义层 setCoverBytes（sniffers 单点）
    await IpcClient.invoke<void>('cache:setCoverBytes', coverUrl, Buffer.from(bytes));
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
  // 初始不直接渲染远程 URL：先查磁盘缓存（签名过期 URL 直接渲染会立刻加载失败，
  // 触发无谓的 onError 刷新和兜底图闪烁——即使缓存里有可用文件）
  const [src, setSrc] = useState<string>(() => (!coverUrl || coverUrl.startsWith('file://') ? coverUrl : ''));

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
