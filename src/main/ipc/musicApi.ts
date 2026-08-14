import { probeAudioUrl } from '@mplayer/core';
import type { Song, AudioTag } from '@mplayer/core';
import { registerIpcHandler, registerIpcHandlerSimple } from './registerHandler';
import { getAggregatedChart } from '../services/chartAggregator';
import { getThrottleWaitMs, invalidateCoverUrl } from '../api/musicApi';
import { cacheResolvedCover } from './cache';

type MusicApi = typeof import('../api/musicApi').musicApi & {
  getSodaPlayableUrl(trackId: string): Promise<string>;
};

interface ProbeResult {
  songId: string;
  tag: AudioTag;
}

async function probeSongBatch(songs: Song[], api: MusicApi): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const concurrency = Math.min(20, Math.max(1, songs.length));
  let index = 0;

  async function worker(): Promise<void> {
    while (index < songs.length) {
      const song = songs[index++];
      try {
        let url = song.url;
        try {
          url = (await api.getAudioUrl(url)) || url;
        } catch {
          // keep the original URL; probeAudioUrl will classify it
        }
        const tag = url ? await probeAudioUrl(url) : 'invalid';
        results.push({ songId: song.id, tag });
      } catch {
        results.push({ songId: song.id, tag: 'valid' });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export function registerMusicApiIpc(musicApi: MusicApi): void {
  registerIpcHandlerSimple('api:getThrottleWait', () => getThrottleWaitMs());
  registerIpcHandler('lyrics:get', (lrcUrl: string) => musicApi.getLyrics(lrcUrl));
  registerIpcHandler('musicApi:getAudioUrl', (audioUrl: string) => musicApi.getAudioUrl(audioUrl));
  registerIpcHandler('musicApi:resolveCoverUrl', async (coverUrl: string) => {
    const resolved = await musicApi.resolveCoverUrl(coverUrl);
    // 解析成功且拿到 CDN 直链 → 主进程下载真实图片写入磁盘封面缓存
    // （渲染层无会话 cookie 无法自行缓存受保护端点），失败不影响渲染
    if (resolved && resolved !== coverUrl && /^https?:\/\//.test(resolved)) {
      void cacheResolvedCover(coverUrl, resolved);
    }
    return resolved;
  });
  registerIpcHandler('musicApi:probeAudio', (songs: Song[]) => probeSongBatch(Array.isArray(songs) ? songs : [], musicApi));
  // 封面失效：清除主进程 6h 归一化解析缓存（新签名 URL 归一化 key 相同会
  // 命中失效直链循环失败），配合渲染层重搜换新签名封面
  registerIpcHandler('musicApi:invalidateCoverUrl', async (coverUrl: string) => {
    invalidateCoverUrl(coverUrl);
  });
  registerIpcHandler('musicApi:getSodaAudioUrl', (trackId: string) => musicApi.getSodaAudioUrl(trackId));
  registerIpcHandler('musicApi:getSodaPlayableUrl', (trackId: string) => musicApi.getSodaPlayableUrl(trackId));
  registerIpcHandler('musicApi:parseSodaShareLink', (link: string) => musicApi.parseSodaShareLink(link));
  registerIpcHandler('musicApi:searchSongs', (keyword: string, page: number, sourceType: any) => musicApi.searchSongs(keyword, page, sourceType));
  registerIpcHandler('musicApi:searchSongById', (songId: string, sourceType: any) => musicApi.searchSongById(songId, sourceType));
  registerIpcHandler('musicApi:batchSearch', (keywords: string[], sourceType: any) => musicApi.batchSearch(keywords, sourceType));
  registerIpcHandler('musicApi:searchAllSources', (keyword: string, page: number) => musicApi.searchAllSources(keyword, page));
  registerIpcHandler('musicApi:getNeteaseHotlist', () => musicApi.getNeteaseHotlist());
  registerIpcHandler('musicApi:getNeteaseNewSongList', () => musicApi.getNeteaseNewSongList());
  registerIpcHandler('musicApi:getQQHotlist', () => musicApi.getQQHotlist());
  registerIpcHandler('musicApi:getQQNewSongList', () => musicApi.getQQNewSongList());
  registerIpcHandler('musicApi:getNeteasePlaylists', (cat: string, order: string, offset: number, limit: number) => musicApi.getNeteasePlaylists(cat, order, offset, limit));
  registerIpcHandler('musicApi:getNeteasePlaylistDetail', (id: number) => musicApi.getNeteasePlaylistDetail(id));
  registerIpcHandler('musicApi:getNeteasePlaylistSongs', (id: number, limit?: number) => musicApi.getNeteasePlaylistSongs(id, limit || 0));
  registerIpcHandler('musicApi:getNeteasePlaylistSongsPage', (id: number, offset: number, limit: number, skipSearchFallback?: boolean) => musicApi.getNeteasePlaylistSongsPage(id, offset, limit, skipSearchFallback));
  registerIpcHandler('musicApi:getPlaylistSongsFromThirdParty', (playlistUrl: string, sourceType: any = 'netease') => musicApi.getPlaylistSongsFromThirdParty(playlistUrl, sourceType));
  registerIpcHandler('musicApi:getNeteaseArtists', (cat: number, offset: number, limit: number, initial: number) => musicApi.getNeteaseArtists(cat, offset, limit, initial));
  registerIpcHandler('musicApi:getArtistSongs', (artistId: string, offset: number, limit: number, order: string) => musicApi.getNeteaseArtistSongs(artistId, offset, limit, order));
  registerIpcHandler('musicApi:searchArtists', (keyword: string, limit: number) => musicApi.searchNeteaseArtists(keyword, limit));
  registerIpcHandler('musicApi:getAggregatedChart', (type: 'hot' | 'new', sources: string[]) => getAggregatedChart(type, sources as any));
  registerIpcHandler('musicApi:getNewAlbums', (area: string, offset: number, limit: number) => musicApi.getNewAlbums(area, offset, limit));
  registerIpcHandler('musicApi:getAlbumDetail', (albumId: string, skipSearchFallback?: boolean) => musicApi.getAlbumDetail(albumId, skipSearchFallback));
  // 后台补齐无 URL 歌曲（专辑名预搜 1 次批量命中 + 剩余逐首兜底，不在页面主链路上阻塞）：
  // 返回补齐后的歌曲数组（resolveNeteaseSongUrlsBySearch 原地补 url）
  registerIpcHandler('musicApi:fillSongUrls', (songs: Song[], albumName?: string) =>
    musicApi
      .resolveNeteaseSongUrlsBySearch(Array.isArray(songs) ? songs : [], albumName)
      .then(() => songs)
  );
  registerIpcHandler('musicApi:getArtistAlbums', (artistId: string, offset: number, limit: number) => musicApi.getArtistAlbums(artistId, offset, limit));
  registerIpcHandler('musicApi:getRecommendedPlaylists', (limit: number) => musicApi.getRecommendedPlaylists(limit));
  registerIpcHandler('musicApi:getRecommendedSongs', (limit: number) => musicApi.getRecommendedSongs(limit));
  registerIpcHandler('musicApi:getPlaylists', async (cat: string, order: string, offset: number, limit: number) => {
    const result = await musicApi.getNeteasePlaylists(cat, order, offset, limit);
    return result.playlists;
  });
}
