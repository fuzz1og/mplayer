import { IpcClient } from '@/renderer/services/IpcClient';
import { cacheCoverImage } from '@/renderer/services/coverCacheService';
import { findExactMatch, stripSourceIdPrefix } from '@mplayer/core';
import type { Song } from '@mplayer/core';

// 会话级重试：同一首歌最多刷新 3 次（"失败三次才放弃"），成功后清零
const MAX_ATTEMPTS = 3;
const attempts = new Map<string, number>();
// 全局并发限制：整列表封面同时失效/为空时同时刷新会打爆 上游 API
const REFRESH_MAX_CONCURRENT = 5;
let refreshInFlight = 0;

async function withRefreshLimit<T>(fn: () => Promise<T>): Promise<T> {
  while (refreshInFlight >= REFRESH_MAX_CONCURRENT) {
    await new Promise((r) => setTimeout(r, 200));
  }
  refreshInFlight++;
  try {
    return await fn();
  } finally {
    refreshInFlight--;
  }
}

/**
 * 封面加载失败时刷新歌曲封面（上游 API 签名过期后同一 URL 永远失败，必须换新 URL）。
 * 策略（"失败三次才放弃"）：
 * 1. 按源站 ID 识别（链接会过期，ID 不会）
 * 2. 名字搜索 + 精确匹配（严格匹配防翻唱/Live 误配）
 * 3. 放弃，返回 null（UI 保持默认图，下次进入页面时重试）
 * 找到新封面后同步更新 URL 缓存并预热封面图片；失败静默。
 */
export function refreshSongCover(song: Song): Promise<string | null> {
  if (!song || song.sourceType === 'local' || song.sourceType === 'soda') return Promise.resolve(null);

  const attemptKey = `${song.sourceType}:${song.id}`;
  const count = attempts.get(attemptKey) ?? 0;
  if (count >= MAX_ATTEMPTS) return Promise.resolve(null);
  attempts.set(attemptKey, count + 1);

  return withRefreshLimit(async () => {
    const baseId = stripSourceIdPrefix(song.id || '');
    let fresh: Song | null = null;

    // 第 1 次尝试：按源站 ID 识别
    if (baseId) {
      try {
        fresh = await IpcClient.invoke<Song | null>('musicApi:searchSongById', baseId, song.sourceType);
      } catch {
        fresh = null;
      }
    }

    // 第 2 次尝试：名字搜索 + 精确匹配（只接受 name+artist 完全匹配，避免翻唱/Live）
    if (!fresh?.cover && song.name) {
      try {
        const results = await IpcClient.invoke<Song[]>('musicApi:searchSongs', `${song.name} ${song.artist}`, 1, song.sourceType);
        const matched = findExactMatch({ name: song.name, artist: song.artist }, results) as Song | undefined;
        if (matched?.cover) fresh = matched;
      } catch {
        fresh = null;
      }
    }

    const cover = fresh?.cover;
    if (!cover) return null;

    attempts.delete(attemptKey);

    // 更新 URL 缓存，后续刷新直接命中新封面
    await IpcClient.invoke<void>('cache:setUrl', song.id, {
      url: fresh?.url || '',
      cover,
      lrc: fresh?.lrc || '',
    }).catch(() => {});
    cacheCoverImage(cover).catch(() => {});
    return cover;
  });
}
