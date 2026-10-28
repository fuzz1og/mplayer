import { registerIpcHandler } from './registerHandler';
import type { db } from '../storage/db';
import { getLocalMusicService } from '../services/localMusicService';

type Db = typeof db;

const toFileUrl = (path: string): string => `file:///${path.replace(/\\/g, '/')}`;

/**
 * 收藏与历史只落 SongBase（无 url）。本地曲目没有可解析的源，读出来必须按 id 回查本地库补上
 * url / 封面，否则在收藏页、历史页点播放会按网络源归因失败（#711）。
 */
async function withLocalPlayback<T extends { id: string; cover?: string }>(songs: T[]): Promise<(T & { url?: string })[]> {
  if (songs.length === 0) return songs;
  const localSongs = await getLocalMusicService().getSongs().catch(() => []);
  if (localSongs.length === 0) return songs;
  const byId = new Map(localSongs.map(song => [song.id, song]));
  return songs.map((song) => {
    const local = byId.get(song.id);
    if (!local) return song;
    return {
      ...song,
      url: toFileUrl(local.filePath),
      cover: song.cover || (local.coverPath ? toFileUrl(local.coverPath) : ''),
    };
  });
}

export function registerFavoriteIpc(db: Db): void {
  registerIpcHandler('favorite:add', (song: any) => db.addFavorite(song));
  registerIpcHandler('favorite:remove', (songId: string) => db.removeFavorite(songId));
  registerIpcHandler('favorite:isFavorite', (songId: string) => db.isFavorite(songId));
  registerIpcHandler('favorite:getAll', async () => withLocalPlayback(await db.getFavorites()));
  registerIpcHandler('favorite:replaceSong', (oldSongId: string, newSong: any) => db.replaceFavoriteSong(oldSongId, newSong));
}

export function registerHistoryIpc(db: Db): void {
  registerIpcHandler('history:add', (song: any) => db.addToPlayHistory(song));
  registerIpcHandler('history:get', async (limit?: number) => {
    const rows = await db.getPlayHistory(limit);
    const enriched = await withLocalPlayback(rows.map(row => row.song));
    return rows.map((row, index) => ({ ...row, song: enriched[index] }));
  });
  registerIpcHandler('history:clear', () => db.clearPlayHistory());
  registerIpcHandler('history:remove', (songId: string) => db.removeFromPlayHistory(songId));
}

export function registerPlaylistIpc(db: Db): void {
  registerIpcHandler('playlist:create', (name: string, description?: string) => db.createPlaylist(name, description));
  registerIpcHandler('playlist:getAll', () => db.getPlaylists());
  registerIpcHandler('playlist:get', (playlistId: number) => db.getPlaylist(playlistId));
  registerIpcHandler('playlist:update', (playlistId: number, playlist: any) => db.updatePlaylist(playlistId, playlist));
  registerIpcHandler('playlist:delete', (playlistId: number) => db.deletePlaylist(playlistId));
  // 批量加入（#493）：整批一次落盘，返回真正新增的条目 id（部分成功；0 首 = []，不抛错）
  registerIpcHandler('playlist:addSongs', (playlistId: number, songs: any[]) => db.addSongsToPlaylist(playlistId, songs));
  registerIpcHandler('playlist:removeSong', (playlistId: number, songId: string) => db.removeSongFromPlaylist(playlistId, songId));
  registerIpcHandler('playlist:getSongs', (playlistId: number) => db.getPlaylistSongs(playlistId));
  registerIpcHandler('playlist:updateSongsOrder', (playlistId: number, songId: string, order: number) => db.updatePlaylistSongOrder(playlistId, songId, order));
  registerIpcHandler('playlist:replaceSong', (playlistId: number, oldSongId: string, newSong: any) => db.replacePlaylistSong(playlistId, oldSongId, newSong));
  registerIpcHandler('playlist:reorderFull', async (playlistId: number, songIds: string[]) => {
    await db.reorderSongIds(playlistId, songIds);
  });
}
