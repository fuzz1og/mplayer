import type { DiscoverPlaylist } from '@mplayer/core';
import { cacheManager, getApiClient } from '@mplayer/core';

const ALBUMS_CACHE_TTL = 60 * 60 * 1000;
const RECOMMENDED_CACHE_TTL = 15 * 60 * 1000;
const PLAYLIST_LIST_CACHE_TTL = 30 * 60 * 1000;

export interface Album {
  id: string;
  name: string;
  picUrl: string;
  artist: string;
  publishTime: string;
}

function normalizeNeteaseAlbum(raw: any): Album {
  const artist = (raw.artists || raw.artist)
    ?.map((a: any) => a.name || '')
    .filter(Boolean)
    .join(' / ') || '';

  return {
    id: String(raw.id),
    name: raw.name || raw.album?.name || '',
    picUrl: raw.picUrl || raw.album?.picUrl || raw.coverImgUrl || '',
    artist,
    publishTime: raw.publishTime || raw.publish_time || '',
  };
}

export async function getNewAlbums(area: string = 'ALL', offset: number = 0, limit: number = 30): Promise<Album[]> {
  const cacheKey = `album_new_${area}`;
  const cached = cacheManager.get<Album[]>(cacheKey);
  if (cached) return cached;

  const client = getApiClient();
  const response = await client.get(`/album/new?area=${area}&offset=${offset}&limit=${limit}`);
  const data = response.data;

  // Support both proxy format (direct array) and NetEase format ({ albums: [...] })
  const rawAlbums = Array.isArray(data) ? data : data?.albums;
  if (!rawAlbums || !Array.isArray(rawAlbums)) return [];

  const albums = rawAlbums.map(normalizeNeteaseAlbum);
  cacheManager.set(cacheKey, albums, ALBUMS_CACHE_TTL);
  return albums;
}

export async function getRecommendedPlaylists(limit: number = 30): Promise<DiscoverPlaylist[]> {
  const cacheKey = 'personalized_playlist';
  const cached = cacheManager.get<DiscoverPlaylist[]>(cacheKey);
  if (cached) return cached;

  const client = getApiClient();
  const response = await client.get(`/personalized/playlist?limit=${limit}`);
  const data = response.data;

  // Support both proxy format (direct array) and NetEase format ({ result: [...] })
  const rawPlaylists = Array.isArray(data) ? data : data?.result;
  if (!rawPlaylists || !Array.isArray(rawPlaylists)) return [];

  const playlists = rawPlaylists.map((p: any) => ({
    id: p.id,
    name: p.name,
    coverImgUrl: p.picUrl || p.coverImgUrl || '',
    playCount: p.playCount || 0,
    trackCount: p.trackCount || 0,
    creator: p.creator ? { nickname: p.creator.nickname || '' } : { nickname: '' },
    tags: [],
    description: p.copywriter || p.description || '',
  }));

  cacheManager.set(cacheKey, playlists, RECOMMENDED_CACHE_TTL);
  return playlists;
}

export async function getRecommendedSongs(limit: number = 30): Promise<any[]> {
  const cacheKey = 'personalized_newsong';
  const cached = cacheManager.get<any[]>(cacheKey);
  if (cached) return cached;

  const client = getApiClient();
  const response = await client.get(`/personalized/newsong?limit=${limit}`);
  const data = response.data;

  // Support both proxy format (direct array) and NetEase format ({ result: [...] })
  const rawSongs = Array.isArray(data) ? data : data?.result;
  if (!rawSongs || !Array.isArray(rawSongs)) return [];

  const songs = rawSongs.map((s: any) => ({
    id: String(s.id),
    name: s.name || '',
    artist: (s.artists || []).map((a: any) => a.name).join(' / ') || s.song?.artists?.[0]?.name || '',
    album: s.album?.name || s.song?.album?.name || '',
    url: '',
    cover: s.album?.picUrl || s.picUrl || s.song?.album?.picUrl || '',
    lrc: '',
    duration: s.duration ? Math.floor(s.duration / 1000) : s.song?.duration ? Math.floor(s.song.duration / 1000) : 0,
    sourceType: 'netease' as const,
  }));

  cacheManager.set(cacheKey, songs, RECOMMENDED_CACHE_TTL);
  return songs;
}

export async function getPlaylistLists(cat: string = '全部', order: string = 'hot', offset: number = 0, limit: number = 30): Promise<DiscoverPlaylist[]> {
  const cacheKey = `playlist_list_${cat}_${order}`;
  const cached = cacheManager.get<DiscoverPlaylist[]>(cacheKey);
  if (cached) return cached;

  const client = getApiClient();
  const response = await client.get(`/playlist/list?cat=${encodeURIComponent(cat)}&order=${order}&offset=${offset}&limit=${limit}`);
  const data = response.data;

  const rawPlaylists = Array.isArray(data) ? data : data?.playlists;
  if (!rawPlaylists || !Array.isArray(rawPlaylists)) return [];

  const playlists = rawPlaylists.map((p: any) => ({
    id: p.id,
    name: p.name,
    coverImgUrl: p.coverImgUrl || '',
    playCount: p.playCount || 0,
    trackCount: p.trackCount || 0,
    creator: p.creator ? { nickname: p.creator.nickname || '' } : { nickname: '' },
    tags: p.tags || [],
    description: p.description || '',
  }));

  cacheManager.set(cacheKey, playlists, PLAYLIST_LIST_CACHE_TTL);
  return playlists;
}
