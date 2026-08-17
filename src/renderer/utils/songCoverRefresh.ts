import { IpcClient } from '@/renderer/services/IpcClient';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { cacheCoverImage } from '@/renderer/services/coverCacheService';
import { invalidateCoverUrl } from '@/renderer/services/coverUrlResolver';
import { findExactMatch, stripSourceIdPrefix } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { isLegacyDeadUrl } from '@/shared/legacyUrl';

// 会话级重试：同一首歌最多刷新 3 次（"失败三次才放弃"），成功后清零；
// 失败记录 5 分钟过期——瞬时故障不能永久放弃该歌（重新进入页面应重试）
const MAX_ATTEMPTS = 3;
const ATTEMPT_RESET_TTL = 5 * 60 * 1000;
const attempts = new Map<string, { count: number; at: number }>();
// 刷新冷却：刚刷新过的歌 60 秒内不再刷新（新签名 URL 可能再次失败，
// 无冷却会形成"刷新→失败→再刷新"风暴，每轮一次上游搜索，打爆 API）
const LAST_REFRESH_TTL = 60 * 1000;
const lastRefreshAt = new Map<string, number>();
// 进行中的刷新去重：同一首歌可能同时在行/播放栏/歌词页触发刷新，合并为一次
const inFlightRefreshes = new Map<string, Promise<string | null>>();
// 全局并发限制：整列表封面同时失效/为空时同时刷新会打爆 上游 API
// （服务端对同 IP 并发有硬限制，core 全局闸门再兜底）
const REFRESH_MAX_CONCURRENT = 3;
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

/** 测试专用：重置会话级刷新状态（attempts/冷却/进行中），保证用例间隔离 */
export function __resetSongCoverRefreshState(): void {
  attempts.clear();
  lastRefreshAt.clear();
  inFlightRefreshes.clear();
  refreshInFlight = 0;
}

/**
 * 封面加载失败时刷新歌曲封面（上游 API 签名过期后同一 URL 永远失败，必须换新 URL）。
 * 策略（"失败三次才放弃"）：
 * 1. 按源站 ID 识别（链接会过期，ID 不会）
 * 2. 名字搜索 + 精确匹配（严格匹配防翻唱/Live 误配）
 * 3. 放弃，返回 null（UI 保持默认图，5 分钟后重试）
 * 找到新封面后同步更新 URL 缓存（只替换封面，不动已有 url/lrc）并预热封面图片；
 * 失败静默。同歌并发触发合并为一次；60 秒冷却防刷新风暴。
 */
export function refreshSongCover(song: Song): Promise<string | null> {
  if (!song || song.sourceType === 'local' || song.sourceType === 'soda') return Promise.resolve(null);
  // 旧封面已失效：先清解析缓存（渲染层 + 主进程 6h 归一化 + 磁盘）。
  // 否则搜索拿到的新签名 URL 归一化 key 相同，会命中失效直链循环失败
  if (song.cover) invalidateCoverUrl(song.cover);

  const attemptKey = `${song.sourceType}:${song.id}`;

  // 进行中 → 复用同一请求（多页面同时触发不重复搜索）
  const running = inFlightRefreshes.get(attemptKey);
  if (running) return running;

  // 冷却中 → 跳过（新签名 URL 可能再次失败，等 60 秒再试）
  const lastAt = lastRefreshAt.get(attemptKey) ?? 0;
  if (Date.now() - lastAt < LAST_REFRESH_TTL) return Promise.resolve(null);

  // 失败记录 5 分钟过期：瞬时故障不能永久放弃
  const rec = attempts.get(attemptKey);
  if (rec && Date.now() - rec.at > ATTEMPT_RESET_TTL) attempts.delete(attemptKey);
  const count = attempts.get(attemptKey)?.count ?? 0;
  if (count >= MAX_ATTEMPTS) return Promise.resolve(null);
  attempts.set(attemptKey, { count: count + 1, at: Date.now() });
  lastRefreshAt.set(attemptKey, Date.now());

  const promise = withRefreshLimit(async () => {
    const baseId = stripSourceIdPrefix(song.id || '');
    let fresh: Song | null = null;

    // 第 1 次尝试：按源站 ID 识别
    if (baseId) {
      try {
        fresh = await callMusicApi('searchSongById', baseId, song.sourceType);
      } catch {
        fresh = null;
      }
    }

    // 第 2 次尝试：名字搜索 + 精确匹配（只接受 name+artist 完全匹配，避免翻唱/Live）
    if (!fresh?.cover && song.name) {
      try {
        const results = await callMusicApi('searchSongsRouted', `${song.name} ${song.artist}`, 1, song.sourceType);
        const matched = findExactMatch({ name: song.name, artist: song.artist }, results) as Song | undefined;
        if (matched?.cover) fresh = matched;
      } catch {
        fresh = null;
      }
    }

    const cover = fresh?.cover;
    if (!cover) return null;

    attempts.delete(attemptKey);

    // 更新 URL 缓存：只替换封面，保留已有 url/lrc
    // （搜索结果的 url 常为空，整体覆盖会让本来可播的歌变"无法播放"，歌词也会丢）
    const existing = await IpcClient.invoke<{ url?: string; lrc?: string } | null>('cache:getSongResources', song.id).catch(() => null);
    const safeExisting =
      existing && !isLegacyDeadUrl(existing.url) && !isLegacyDeadUrl(existing.lrc) ? existing : null;
    await IpcClient.invoke<void>('cache:setSongResources', song.id, {
      url: fresh?.url || safeExisting?.url || '',
      cover,
      lrc: fresh?.lrc || safeExisting?.lrc || '',
    }).catch(() => {});
    cacheCoverImage(cover).catch(() => {});
    return cover;
  });
  inFlightRefreshes.set(attemptKey, promise);
  promise.finally(() => { inFlightRefreshes.delete(attemptKey); }).catch(() => {});
  return promise;
}
