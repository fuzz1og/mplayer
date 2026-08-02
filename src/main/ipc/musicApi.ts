import { probeAudio, probeAudioUrl } from '@mplayer/core';
import type { Song, AudioTag } from '@mplayer/core';
import { registerIpcHandler } from './registerHandler';
import { getAggregatedChart } from '../services/chartAggregator';

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
        let tag: AudioTag;
        if (song.sourceType === 'soda') {
          // Probe resolves the trackId to a real link so preview detection is accurate.
          let sodaUrl = '';
          try {
            sodaUrl = await api.getSodaAudioUrl(song.id);
          } catch {
            // fall through to duration-based classification
          }
          tag = sodaUrl ? await probeAudioUrl(sodaUrl) : await probeAudio(song);
        } else {
          let url = song.url;
          try {
            url = (await api.getAudioUrl(url)) || url;
          } catch {
            // keep the original URL; probeAudioUrl will classify it
          }
          tag = url ? await probeAudioUrl(url) : 'invalid';
        }
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
  registerIpcHandler('lyrics:get', (lrcUrl: string) => musicApi.getLyrics(lrcUrl));
  registerIpcHandler('musicApi:getAudioUrl', (audioUrl: string) => musicApi.getAudioUrl(audioUrl));
  registerIpcHandler('musicApi:probeAudio', (songs: Song[]) => probeSongBatch(Array.isArray(songs) ? songs : [], musicApi));
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
  registerIpcHandler('musicApi:getNeteasePlaylistSongs', (id: number, limit?: number) => musicApi.getNeteasePlaylistSongs(id, limit || 0));
  registerIpcHandler('musicApi:getNeteasePlaylistSongsPage', (id: number, offset: number, limit: number) => musicApi.getNeteasePlaylistSongsPage(id, offset, limit));
  registerIpcHandler('musicApi:getPlaylistSongsFromThirdParty', (playlistUrl: string, sourceType: any = 'netease') => musicApi.getPlaylistSongsFromThirdParty(playlistUrl, sourceType));
  registerIpcHandler('musicApi:getNeteaseArtists', (cat: number, offset: number, limit: number, initial: number) => musicApi.getNeteaseArtists(cat, offset, limit, initial));
  registerIpcHandler('musicApi:getArtistSongs', (artistId: string, offset: number, limit: number, order: string) => musicApi.getNeteaseArtistSongs(artistId, offset, limit, order));
  registerIpcHandler('musicApi:searchArtists', (keyword: string, limit: number) => musicApi.searchNeteaseArtists(keyword, limit));
  registerIpcHandler('musicApi:getAggregatedChart', (type: 'hot' | 'new', sources: string[]) => getAggregatedChart(type, sources as any));
  registerIpcHandler('musicApi:getNewAlbums', (area: string, offset: number, limit: number) => musicApi.getNewAlbums(area, offset, limit));
  registerIpcHandler('musicApi:getRecommendedPlaylists', (limit: number) => musicApi.getRecommendedPlaylists(limit));
  registerIpcHandler('musicApi:getRecommendedSongs', (limit: number) => musicApi.getRecommendedSongs(limit));
  registerIpcHandler('musicApi:getPlaylists', async (cat: string, order: string, offset: number, limit: number) => {
    const result = await musicApi.getNeteasePlaylists(cat, order, offset, limit);
    return result.playlists;
  });
}
