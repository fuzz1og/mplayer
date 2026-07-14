import type { Song } from '../types/index.js';
import { musicApi } from '../api/musicApi.js';

export async function resolveSongUrls(
  name: string,
  artist: string,
  sourceType: string
): Promise<Song[]> {
  const songs = await musicApi.searchSongs(`${name} ${artist}`, 1, sourceType as any);
  return songs ?? [];
}
