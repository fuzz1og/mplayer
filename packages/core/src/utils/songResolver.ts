import type { Song } from '../types/index.js';

export type SearchFn = (keyword: string, page: number, sourceType: string) => Promise<Song[]>;

export function createResolveSongUrls(searchFn: SearchFn) {
  return async (name: string, artist: string, sourceType: string): Promise<Song[]> => {
    const songs = await searchFn(`${name} ${artist}`, 1, sourceType);
    return songs ?? [];
  };
}