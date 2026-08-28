import { ipcMain } from 'electron';
import type { Song, SourceKey } from '@mplayer/core';
import type { ApiResponse } from '@/shared/types/ipc';
import type { MusicApiMethod, MusicApiMethodMap, MainOnlyMethods } from '@/shared/musicApiContract';
import { getAggregatedChart } from '../services/chartAggregator';

/**
 * music 域 IPC 单通道分发（ADR-0001）：`musicApi:call` 查表分发。
 * 分发表 `dispatch` `satisfies MusicApiMethodMap`——方法名拼错 / 签名不符 /
 * 漏方法 → 编译期必报错。
 */

/**
 * main.ts 扩展后的完整 musicApi（core 方法 + getSodaPlayableUrl + resolvePlaylistLink）。
 * MainOnly 方法签名已由 contract 的 `MainOnlyMethods` 声明，此处只引用不重复。
 */
type CoreMusicApi = typeof import('@/main/api/musicApi').musicApi;
type MusicApi = Pick<CoreMusicApi, MusicApiMethod> & {
  getSodaPlayableUrl: MainOnlyMethods['getSodaPlayableUrl'];
  resolvePlaylistLink: MainOnlyMethods['resolvePlaylistLink'];
};

/**
 * 注册单个 `musicApi:call` 分发通道。
 * 旧 `musicApi:*` / `lyrics:get` / `api:getThrottleWait` 通道已删除，music 域收敛为
 * `musicApi:call` 单通道；core 方法通过 MUSIC_API_METHODS 收编，MainOnly 方法
 * （getAggregatedChart / getSodaPlayableUrl / resolvePlaylistLink）在分发表内单独接线。
 */
export function registerMusicApiCall(api: MusicApi): void {
  const dispatch = {
    // ── core musicApi 方法（泛型 forward）────────────────────────
    probeSongsBatch: (s: Song[]) => api.probeSongsBatch(s),
    getLyrics: (url: string) => api.getLyrics(url),
    getLyricsBySongId: (id: string) => api.getLyricsBySongId(id),
    getNeteaseHotlist: () => api.getNeteaseHotlist(),
    getNeteaseNewSongList: () => api.getNeteaseNewSongList(),
    getQQHotlist: () => api.getQQHotlist(),
    getQQNewSongList: () => api.getQQNewSongList(),
    getNeteasePlaylists: (cat: string, order: string, offset: number, limit: number) =>
      api.getNeteasePlaylists(cat, order, offset, limit),
    getNeteasePlaylistDetail: (id: number) => api.getNeteasePlaylistDetail(id),
    getNeteasePlaylistSongs: (id: number, limit?: number) => api.getNeteasePlaylistSongs(id, limit || 0),
    getNeteasePlaylistSongsPage: (id: number, offset: number, limit: number) =>
      api.getNeteasePlaylistSongsPage(id, offset, limit),
    getNeteaseArtists: (cat: number, offset: number, limit: number, initial: number) =>
      api.getNeteaseArtists(cat, offset, limit, initial),
    getNeteaseArtistSongs: (artistId: string, offset: number, limit: number, order: string) =>
      api.getNeteaseArtistSongs(artistId, offset, limit, order),
    searchNeteaseArtists: (keyword: string, limit: number) => api.searchNeteaseArtists(keyword, limit),
    getNewAlbums: (area: string, offset: number, limit: number) => api.getNewAlbums(area, offset, limit),
    getAlbumDetail: (albumId: string) => api.getAlbumDetail(albumId),
    getArtistAlbums: (artistId: string, offset: number, limit: number) =>
      api.getArtistAlbums(artistId, offset, limit),
    getRecommendedPlaylists: (limit: number) => api.getRecommendedPlaylists(limit),
    getRecommendedSongs: (limit: number) => api.getRecommendedSongs(limit),
    getSodaAudioUrl: (trackId: string) => api.getSodaAudioUrl(trackId),
    getSodaLyrics: (trackId: string) => api.getSodaLyrics(trackId),
    parseSodaShareLink: (link: string) => api.parseSodaShareLink(link),
    searchSongsRouted: (k: string, p: number, s: SourceKey) => api.searchSongsRouted(k, p, s),
    resolvePlayableUrlRouted: (song: Song) => api.resolvePlayableUrlRouted(song),
    resolvePlayableSongRouted: (song: Song) => api.resolvePlayableSongRouted(song),
    // ── main 独有组合方法 ─────────────────────────────────────────
    getAggregatedChart,
    getSodaPlayableUrl: (trackId: string) => api.getSodaPlayableUrl(trackId),
    resolvePlaylistLink: (url: string) => api.resolvePlaylistLink(url),
  } satisfies MusicApiMethodMap;

  ipcMain.handle(
    'musicApi:call',
    async <T>(
      event: Electron.IpcMainInvokeEvent,
      method: string,
      ...args: unknown[]
    ): Promise<ApiResponse<T>> => {
      // 审查修复：sender 校验（仅应用页面可调用；测试直接调用无 senderFrame 时放行）
      const senderUrl = event?.senderFrame?.url;
      const isTrusted =
        !senderUrl ||
        senderUrl.startsWith('file://') ||
        (process.env.VITE_DEV_SERVER_URL ? senderUrl.startsWith(process.env.VITE_DEV_SERVER_URL) : false);
      if (!isTrusted) {
        console.warn(`[IPC] 拦截非可信来源 musicApi:call: ${senderUrl ?? 'unknown'}`);
        return { success: false, error: 'IPC 来源不受信任' };
      }

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
