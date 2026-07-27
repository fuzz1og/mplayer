import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song } from '@mplayer/core';

export async function resolveSongUrls(
  name: string,
  artist: string,
  sourceType: string
): Promise<Song[]> {
  const songs = await IpcClient.invoke<Song[]>('musicApi:searchSongs', `${name} ${artist}`, 1, sourceType);
  return songs ?? [];
}
