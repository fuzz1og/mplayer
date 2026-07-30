import { registerIpcHandler } from './registerHandler';
import { getAggregatedChart } from '../services/chartAggregator';
import { getNewAlbums, getRecommendedPlaylists, getRecommendedSongs, getPlaylistLists } from '../services/discoveryService';

type MusicApi = typeof import('../api/musicApi').musicApi & {
  getSodaPlayableUrl(trackId: string): Promise<string>;
};

export function registerMusicApiIpc(musicApi: MusicApi): void {
  registerIpcHandler('lyrics:get', (lrcUrl: string) => musicApi.getLyrics(lrcUrl));
  registerIpcHandler('musicApi:getAudioUrl', (audioUrl: string) => musicApi.getAudioUrl(audioUrl));
  registerIpcHandler('musicApi:getSodaAudioUrl', (trackId: string) => musicApi.getSodaAudioUrl(trackId));
  registerIpcHandler('musicApi:getSodaPlayableUrl', (trackId: string) => musicApi.getSodaPlayableUrl(trackId));
  registerIpcHandler('musicApi:parseSodaShareLink', (link: string) => musicApi.parseSodaShareLink(link));
  registerIpcHandler('musicApi:searchSongs', (keyword: string, page: number, sourceType: any) => musicApi.searchSongs(keyword, page, sourceType));
  registerIpcHandler('musicApi:batchSearch', (keywords: string[], sourceType: any) => musicApi.batchSearch(keywords, sourceType));
  registerIpcHandler('musicApi:searchAllSources', (keyword: string, page: number) => musicApi.searchAllSources(keyword, page));
  registerIpcHandler('musicApi:getNeteaseHotlist', () => musicApi.getNeteaseHotlist());
  registerIpcHandler('musicApi:getNeteaseNewSongList', () => musicApi.getNeteaseNewSongList());
  registerIpcHandler('musicApi:getQQHotlist', () => musicApi.getQQHotlist());
  registerIpcHandler('musicApi:getQQNewSongList', () => musicApi.getQQNewSongList());
  registerIpcHandler('musicApi:getNeteasePlaylists', (cat: string, order: string, offset: number, limit: number) => musicApi.getNeteasePlaylists(cat, order, offset, limit));
  registerIpcHandler('musicApi:getNeteasePlaylistDetail', (id: number) => musicApi.getNeteasePlaylistDetail(id));
  registerIpcHandler('musicApi:getPlaylistSongsFromThirdParty', (playlistUrl: string, sourceType: any = 'netease') => musicApi.getPlaylistSongsFromThirdParty(playlistUrl, sourceType));
  registerIpcHandler('musicApi:getNeteaseArtists', (cat: number, offset: number, limit: number, initial: number) => musicApi.getNeteaseArtists(cat, offset, limit, initial));
  registerIpcHandler('musicApi:getArtistSongs', (artistId: string, offset: number, limit: number, order: string) => musicApi.getNeteaseArtistSongs(artistId, offset, limit, order));
  registerIpcHandler('musicApi:searchArtists', (keyword: string, limit: number) => musicApi.searchNeteaseArtists(keyword, limit));
  registerIpcHandler('musicApi:getAggregatedChart', (type: 'hot' | 'new', sources: string[]) => getAggregatedChart(type, sources as any));
  registerIpcHandler('musicApi:getNewAlbums', (area: string, offset: number, limit: number) => getNewAlbums(area, offset, limit));
  registerIpcHandler('musicApi:getRecommendedPlaylists', (limit: number) => getRecommendedPlaylists(limit));
  registerIpcHandler('musicApi:getRecommendedSongs', (limit: number) => getRecommendedSongs(limit));
  registerIpcHandler('musicApi:getPlaylists', (cat: string, order: string, offset: number, limit: number) => getPlaylistLists(cat, order, offset, limit));
}
