import type { musicApi } from '@mplayer/core';
import type { AggregatedChartResult } from '@/shared/chart';

/**
 * music 域 IPC 单通道分发契约（ADR-0001）。
 *
 * 桌面渲染↔主进程的 music 域收成一条 `musicApi:call`（方法名 + 参数）通道，
 * 契约由 core `musicApi` 对象派生，签名零重复。本文件只供类型与名字使用，
 * 不依赖 main / renderer。
 */

/**
 * 暴露的 core `musicApi` 方法名字清单（唯一手写物）。
 * 加一个 music 域方法 = core 加方法 + 这里加一个字符串，其余自动。
 */
export const MUSIC_API_METHODS = [
  'searchSongs',
  'searchSongById',
  'getAudioUrl',
  'batchSearch',
  'probeSongsBatch',
  'getLyrics',
  'getNeteaseHotlist',
  'getNeteaseNewSongList',
  'getQQHotlist',
  'getQQNewSongList',
  'getNeteasePlaylists',
  'getNeteasePlaylistDetail',
  'getNeteasePlaylistSongs',
  'getNeteasePlaylistSongsPage',
  'getPlaylistSongsFromThirdParty',
  'getNeteaseArtists',
  'getNeteaseArtistSongs',
  'searchNeteaseArtists',
  'getNewAlbums',
  'getAlbumDetail',
  'getArtistAlbums',
  'getRecommendedPlaylists',
  'getRecommendedSongs',
  'resolveCoverUrl',
  'invalidateCoverUrl',
  'fillSongUrls',
  'getSodaAudioUrl',
  'parseSodaShareLink',
  'searchSongsRouted',
  'resolvePlayableUrlRouted',
] as const;

export type MusicApiMethod = (typeof MUSIC_API_METHODS)[number];

/**
 * 主进程独有组合方法（不在 core `musicApi` 对象上）。
 * - `getAggregatedChart`：多源排行榜聚合（chartAggregator）
 * - `getThrottleWait`：上游限流退避剩余等待 ms（api/musicApi 壳）
 * - `getSodaPlayableUrl`：下载汽水音频到磁盘缓存并回放 file:// 直链（main.ts 扩展）
 */
export interface MainOnlyMethods {
  getAggregatedChart(type: 'hot' | 'new', sources: string[]): Promise<AggregatedChartResult>;
  getThrottleWait(): Promise<number>;
  getSodaPlayableUrl(trackId: string): Promise<string>;
}

/**
 * 完整 method → 签名映射（core 签名零重复）。
 * `Pick<typeof musicApi, MUSIC_API_METHODS>` 保证 core 加方法时 IPC 一个签名不用碰。
 */
export type MusicApiMethodMap = Pick<typeof musicApi, MusicApiMethod> & MainOnlyMethods;
