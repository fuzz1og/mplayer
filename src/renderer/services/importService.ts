import {
  parsePlaylistUrl,
  importFromLink as coreImportFromLink,
} from '@mplayer/core';
import type { ImportSource } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import type { Playlist } from '@mplayer/core';
import type {
  PlaylistUrlInfo,
  ProgressState,
  ImportResult,
} from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';

// 兼容旧导出名（ImportPlaylistModal / 测试仍引用）
export type SourceType = ImportSource;
export type { PlaylistUrlInfo, ProgressState, ImportResult };
export { parsePlaylistUrl };

async function addSongToPlaylist(playlistId: string | number, song: Song): Promise<void> {
  const pid = Number(playlistId);
  const playlist = await IpcClient.invoke<Playlist | undefined>('playlist:get', pid);
  if (!playlist) throw new Error('歌单不存在');
  await IpcClient.invoke<number>('playlist:addSong', pid, song);
}

const importDeps = {
  addSong: addSongToPlaylist,
};

export function importFromLink(
  playlistId: number,
  songs: Song[],
  selectedSongIds: Set<string>,
  existingSongs: Song[],
  onProgress: (state: ProgressState) => void
): Promise<ImportResult> {
  return coreImportFromLink(playlistId, songs, selectedSongIds, existingSongs, importDeps, onProgress);
}
