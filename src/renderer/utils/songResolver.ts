import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song } from '@/shared/types/song';

export async function resolveSongUrls(
  name: string,
  artist: string,
  sourceType: string
): Promise<Song[]> {
  const songs = await IpcClient.invoke<Song[]>('musicApi:searchSongs', `${name} ${artist}`, 1, sourceType);
  return songs ?? [];
}
