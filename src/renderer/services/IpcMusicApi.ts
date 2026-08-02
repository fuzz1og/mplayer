import { IpcClient } from './IpcClient';
import type { Song, SongGroup, SourceKey, DiscoverPlaylist } from '@mplayer/core';

export interface MusicApiProxy {
  searchSongs(keyword: string, page: number, sourceType: SourceKey): Promise<Song[]>;
  getAudioUrl(audioUrl: string): Promise<string>;
  getSodaAudioUrl(trackId: string): Promise<string>;
  getSodaPlayableUrl(trackId: string): Promise<string>;
  parseSodaShareLink(link: string): Promise<Song | null>;
  searchAllSources(keyword: string, page: number): Promise<SongGroup[]>;
  batchSearch(keywords: string[], sourceType: SourceKey): Promise<Record<string, Song[]>>;
  getNeteaseHotlist(): Promise<any[]>;
  getQQHotlist(): Promise<any[]>;
  getNeteaseNewSongList(): Promise<any[]>;
  getQQNewSongList(): Promise<any[]>;
  getNeteasePlaylists(cat: string, order: string, offset: number, limit: number): Promise<any>;
  getNeteasePlaylistDetail(id: number): Promise<DiscoverPlaylist | null>;
  getNeteasePlaylistSongs(id: number, limit?: number): Promise<Song[]>;
  getNeteasePlaylistSongsPage(id: number, offset: number, limit: number): Promise<{ songs: Song[]; total: number }>;
  getPlaylistSongsFromThirdParty(playlistUrl: string, sourceType: SourceKey): Promise<Song[]>;
  getNeteaseArtists(cat: number, offset: number, limit: number, initial: number): Promise<any>;
  getArtistSongs(artistId: string, offset: number, limit: number, order: string): Promise<any>;
  searchArtists(keyword: string, limit: number): Promise<any[]>;
}

export function createIpcMusicApi(): MusicApiProxy {
  return {
    searchSongs: (keyword, page, sourceType) => IpcClient.invoke<Song[]>('musicApi:searchSongs', keyword, page, sourceType),
    getAudioUrl: (audioUrl) => IpcClient.invoke<string>('musicApi:getAudioUrl', audioUrl),
    getSodaAudioUrl: (trackId) => IpcClient.invoke<string>('musicApi:getSodaAudioUrl', trackId),
    getSodaPlayableUrl: (trackId) => IpcClient.invoke<string>('musicApi:getSodaPlayableUrl', trackId),
    parseSodaShareLink: (link) => IpcClient.invoke<Song | null>('musicApi:parseSodaShareLink', link),
    searchAllSources: (keyword, page) => IpcClient.invoke<SongGroup[]>('musicApi:searchAllSources', keyword, page),
    batchSearch: (keywords, sourceType) => IpcClient.invoke<Record<string, Song[]>>('musicApi:batchSearch', keywords, sourceType),
    getNeteaseHotlist: () => IpcClient.invoke<any[]>('musicApi:getNeteaseHotlist'),
    getQQHotlist: () => IpcClient.invoke<any[]>('musicApi:getQQHotlist'),
    getNeteaseNewSongList: () => IpcClient.invoke<any[]>('musicApi:getNeteaseNewSongList'),
    getQQNewSongList: () => IpcClient.invoke<any[]>('musicApi:getQQNewSongList'),
    getNeteasePlaylists: (cat, order, offset, limit) => IpcClient.invoke<any>('musicApi:getNeteasePlaylists', cat, order, offset, limit),
    getNeteasePlaylistDetail: (id) => IpcClient.invoke<DiscoverPlaylist | null>('musicApi:getNeteasePlaylistDetail', id),
    getNeteasePlaylistSongs: (id, limit) => IpcClient.invoke<Song[]>('musicApi:getNeteasePlaylistSongs', id, limit || 0),
    getNeteasePlaylistSongsPage: (id, offset, limit) => IpcClient.invoke<{ songs: Song[]; total: number }>('musicApi:getNeteasePlaylistSongsPage', id, offset, limit),
    getPlaylistSongsFromThirdParty: (playlistUrl, sourceType) => IpcClient.invoke<Song[]>('musicApi:getPlaylistSongsFromThirdParty', playlistUrl, sourceType),
    getNeteaseArtists: (cat, offset, limit, initial) => IpcClient.invoke<any>('musicApi:getNeteaseArtists', cat, offset, limit, initial),
    getArtistSongs: (artistId, offset, limit, order) => IpcClient.invoke<any>('musicApi:getArtistSongs', artistId, offset, limit, order),
    searchArtists: (keyword, limit) => IpcClient.invoke<any[]>('musicApi:searchArtists', keyword, limit),
  };
}

export const ipcMusicApi = createIpcMusicApi();