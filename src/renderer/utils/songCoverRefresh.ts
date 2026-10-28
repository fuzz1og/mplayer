import { IpcClient } from '@/renderer/services/IpcClient';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { findExactMatch } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { isLegacyDeadUrl } from '@mplayer/core';

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
/**
 * 等待槽位的 FIFO 队列（#412）。
 * 此前是 `while (inFlight >= 3) await sleep(200)` 的**忙等轮询**：被限流的调用每 200ms 醒一次、每秒
 * 白烧 5 个定时器，且唤醒顺序不保证公平。
 */
const waitingForSlot: Array<() => void> = [];

async function withRefreshLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (refreshInFlight >= REFRESH_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  }
  refreshInFlight++;
  try {
    return await fn();
  } finally {
    refreshInFlight--;
    waitingForSlot.shift()?.();
  }
}

/**
 * 会话级 Map 的容量护栏（#412）：`attempts` 与 `lastRefreshAt` 此前**只写不清**——
 * 封面持久失效的大列表挂着不动，键会随「见过的歌」一直累积。超过上限时先清过期项，
 * 再按插入顺序淘汰最旧（丢掉的只是「重试计数/冷却」这类记忆，不影响正确性）。
 */
const MAX_REMEMBERED_KEYS = 500;
function pruneRemembered<V>(map: Map<string, V>, atOf: (value: V) => number, ttl: number): void {
  if (map.size <= MAX_REMEMBERED_KEYS) return;
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - atOf(value) > ttl) map.delete(key);
  }
  while (map.size > MAX_REMEMBERED_KEYS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
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
 * 封面失败重识别：本地 URL 缓存优先且不受冷却约束（收藏/历史每轮挂载靠它水合），未命中才重搜；
 * 同步更新 URL 缓存（只替换封面，不动已有 url/lrc）；同歌并发合并，60 秒冷却只约束上游搜索。
 */
export function refreshSongCover(song: Song): Promise<string | null> {
  if (!song || song.sourceType === 'local' || song.sourceType === 'soda') return Promise.resolve(null);

  const attemptKey = `${song.sourceType}:${song.id}`;

  // 进行中 → 复用同一请求（多页面同时触发不重复搜索）
  const running = inFlightRefreshes.get(attemptKey);
  if (running) return running;

  const promise = withRefreshLimit(async () => {
    // 缓存优先，且必须先于冷却/失败计数：收藏、历史只落 SongBase（无 cover），每次页面重挂
    // 都靠这里水合；冷却记的是「上一轮重搜」而非缓存有效期，先过冷却会让切页返回整片变灰。
    // 排除两类必须落回搜索：cover === song.cover（刚失败的同一 URL）与 legacy 死链。
    const cached = await IpcClient
      .invoke<{ url?: string; cover?: string; lrc?: string } | null>('cache:getSongResources', song.id)
      .catch(() => null);
    const cachedCover = cached?.cover && !isLegacyDeadUrl(cached.cover) ? cached.cover : '';
    if (cachedCover && cachedCover !== song.cover) {
      attempts.delete(attemptKey);
      // 与搜索成功路径一致的缓存回写：只替换封面，保留安全 url/lrc
      const safeExisting =
        cached && !isLegacyDeadUrl(cached.url) && !isLegacyDeadUrl(cached.lrc) ? cached : null;
      await IpcClient.invoke<void>('cache:setSongResources', song.id, {
        url: safeExisting?.url || '',
        cover: cachedCover,
        lrc: safeExisting?.lrc || '',
      }).catch(() => {});
      return cachedCover;
    }

    // ── 以下门槛只约束上游搜索（缓存未命中才走到这里）────────────────────
    // 冷却中 → 跳过（新签名 URL 可能再次失败，等 60 秒再试）
    const lastAt = lastRefreshAt.get(attemptKey) ?? 0;
    if (Date.now() - lastAt < LAST_REFRESH_TTL) return null;

    // 失败记录 5 分钟过期：瞬时故障不能永久放弃
    const rec = attempts.get(attemptKey);
    if (rec && Date.now() - rec.at > ATTEMPT_RESET_TTL) attempts.delete(attemptKey);
    const count = attempts.get(attemptKey)?.count ?? 0;
    if (count >= MAX_ATTEMPTS) return null;
    attempts.set(attemptKey, { count: count + 1, at: Date.now() });
    lastRefreshAt.set(attemptKey, Date.now());
    pruneRemembered(attempts, (v) => v.at, ATTEMPT_RESET_TTL);
    pruneRemembered(lastRefreshAt, (v) => v, LAST_REFRESH_TTL);

    let fresh: Song | null = null;

    // 名字搜索 + 精确匹配（只接受 name+artist 完全匹配，避免翻唱/Live）
    if (song.name) {
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
    return cover;
  });
  inFlightRefreshes.set(attemptKey, promise);
  promise.finally(() => { inFlightRefreshes.delete(attemptKey); }).catch(() => {});
  return promise;
}
