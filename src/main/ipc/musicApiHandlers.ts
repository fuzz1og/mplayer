import { ipcMain } from 'electron';
import type { Song } from '@mplayer/core';
import type { ApiResponse } from '@/shared/types/ipc';
import type { MusicApiMethod, MusicApiMethodMap, MainOnlyMethods } from '@/shared/musicApiContract';
import { getAggregatedChart } from '../services/chartAggregator';
import { getThrottleWaitMs } from '../api/musicApi';
import { cacheResolvedCover } from './cache';

/**
 * music 域 IPC 单通道分发（ADR-0001）：`musicApi:call` 查表分发。
 * 分发表 `dispatch` `satisfies MusicApiMethodMap`——方法名拼错 / 签名不符 /
 * 漏方法 → 编译期必报错。
 */

/**
 * main.ts 扩展后的完整 musicApi（core 方法 + getSodaPlayableUrl）。
 * getSodaPlayableUrl 签名已由 contract 的 `MainOnlyMethods` 声明，此处只引用不重复。
 */
type CoreMusicApi = typeof import('@/main/api/musicApi').musicApi;
type MusicApi = Pick<CoreMusicApi, MusicApiMethod> & {
  getSodaPlayableUrl: MainOnlyMethods['getSodaPlayableUrl'];
};

/**
 * 注册单个 `musicApi:call` 分发通道。
 * 旧 `musicApi:*` / `lyrics:get` / `api:getThrottleWait` 通道已删除，music 域收敛为
 * `musicApi:call` 单通道；core 方法通过 MUSIC_API_METHODS 收编，MainOnly 方法
 * （getAggregatedChart / getThrottleWait / getSodaPlayableUrl）在分发表内单独接线。
 */
export function registerMusicApiCall(api: MusicApi): void {
  const dispatch = {
    // ── core musicApi 方法（泛型 forward）────────────────────────
    searchSongs: (k: string, p?: number, s?: any) => api.searchSongs(k, p, s),
    searchSongById: (id: string, s?: any, f?: boolean) => api.searchSongById(id, s, f),
    getAudioUrl: (u: string, sig?: AbortSignal) => api.getAudioUrl(u, sig),
    batchSearch: (kw: string[], s?: any, c?: number) => api.batchSearch(kw, s, c),
    searchAllSources: (k: string, p?: number) => api.searchAllSources(k, p),
    probeSongsBatch: (s: Song[]) => api.probeSongsBatch(s),
    getLyrics: (url: string) => api.getLyrics(url),
    getNeteaseHotlist: () => api.getNeteaseHotlist(),
    getNeteaseNewSongList: () => api.getNeteaseNewSongList(),
    getQQHotlist: () => api.getQQHotlist(),
    getQQNewSongList: () => api.getQQNewSongList(),
    getNeteasePlaylists: (cat: string, order: string, offset: number, limit: number) =>
      api.getNeteasePlaylists(cat, order, offset, limit),
    getNeteasePlaylistDetail: (id: number) => api.getNeteasePlaylistDetail(id),
    getNeteasePlaylistSongs: (id: number, limit?: number) => api.getNeteasePlaylistSongs(id, limit || 0),
    getNeteasePlaylistSongsPage: (id: number, offset: number, limit: number, skipSearchFallback?: boolean) =>
      api.getNeteasePlaylistSongsPage(id, offset, limit, skipSearchFallback),
    getPlaylistSongsFromThirdParty: (url: string, s?: any) => api.getPlaylistSongsFromThirdParty(url, s),
    getNeteaseArtists: (cat: number, offset: number, limit: number, initial: number) =>
      api.getNeteaseArtists(cat, offset, limit, initial),
    getNeteaseArtistSongs: (artistId: string, offset: number, limit: number, order: string) =>
      api.getNeteaseArtistSongs(artistId, offset, limit, order),
    searchNeteaseArtists: (keyword: string, limit: number) => api.searchNeteaseArtists(keyword, limit),
    getNewAlbums: (area: string, offset: number, limit: number) => api.getNewAlbums(area, offset, limit),
    getAlbumDetail: (albumId: string, skipSearchFallback?: boolean) =>
      api.getAlbumDetail(albumId, skipSearchFallback),
    getArtistAlbums: (artistId: string, offset: number, limit: number) =>
      api.getArtistAlbums(artistId, offset, limit),
    getRecommendedPlaylists: (limit: number) => api.getRecommendedPlaylists(limit),
    getRecommendedSongs: (limit: number) => api.getRecommendedSongs(limit),
    invalidateCoverUrl: (coverUrl: string) => api.invalidateCoverUrl(coverUrl),
    fillSongUrls: (songs: Song[], albumName?: string) => api.fillSongUrls(songs, albumName),
    getSodaAudioUrl: (trackId: string) => api.getSodaAudioUrl(trackId),
    parseSodaShareLink: (link: string) => api.parseSodaShareLink(link),
    // resolveCoverUrl：保留主进程下载直链→磁盘封面缓存副作用
    resolveCoverUrl: async (coverUrl: string): Promise<string> => {
      const resolved = await api.resolveCoverUrl(coverUrl);
      // 解析成功且拿到 CDN 直链 → 主进程下载真实图片写入磁盘封面缓存
      // （渲染层无会话 cookie 无法自行缓存受保护端点），失败不影响渲染
      if (resolved && resolved !== coverUrl && /^https?:\/\//.test(resolved)) {
        void cacheResolvedCover(coverUrl, resolved);
      }
      return resolved;
    },
    // ── main 独有组合方法 ─────────────────────────────────────────
    getAggregatedChart,
    getThrottleWait: async () => getThrottleWaitMs(),
    getSodaPlayableUrl: (trackId: string) => api.getSodaPlayableUrl(trackId),
  } satisfies MusicApiMethodMap;

  ipcMain.handle(
    'musicApi:call',
    async <T>(
      _event: Electron.IpcMainInvokeEvent,
      method: string,
      ...args: unknown[]
    ): Promise<ApiResponse<T>> => {
      const handler = (dispatch as Record<string, (...xs: unknown[]) => unknown>)[method];
      if (typeof handler !== 'function') {
        return { success: false, error: `unknown musicApi method: ${method}` };
      }
      try {
        const data = await (handler as any)(...args);
        return { success: true, data };
      } catch (error) {
        console.error(`[IPC] musicApi:call(${method}) 失败:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  );
}
