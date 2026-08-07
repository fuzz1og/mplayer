import { registerIpcHandler } from './registerHandler';
import type { db } from '../storage/db';

type Db = typeof db;

export function registerFavoriteIpc(db: Db): void {
  registerIpcHandler('favorite:add', (song: any) => db.addFavorite(song));
  registerIpcHandler('favorite:remove', (songId: string) => db.removeFavorite(songId));
  registerIpcHandler('favorite:isFavorite', (songId: string) => db.isFavorite(songId));
  registerIpcHandler('favorite:getAll', () => db.getFavorites());
  registerIpcHandler('favorite:updateSongData', (songId: string, songData: any) => db.updateFavoriteSongData(songId, songData));
  registerIpcHandler('favorite:replaceSong', (oldSongId: string, newSong: any) => db.replaceFavoriteSong(oldSongId, newSong));
}

export function registerHistoryIpc(db: Db): void {
  registerIpcHandler('history:add', (song: any) => db.addToPlayHistory(song));
  registerIpcHandler('history:get', (limit?: number) => db.getPlayHistory(limit));
  registerIpcHandler('history:clear', () => db.clearPlayHistory());
  registerIpcHandler('history:remove', (songId: string) => db.removeFromPlayHistory(songId));
}

export function registerPlaylistIpc(db: Db): void {
  registerIpcHandler('playlist:create', (name: string, description?: string) => db.createPlaylist(name, description));
  registerIpcHandler('playlist:getAll', () => db.getPlaylists());
  registerIpcHandler('playlist:get', (playlistId: number) => db.getPlaylist(playlistId));
  registerIpcHandler('playlist:update', (playlistId: number, playlist: any) => db.updatePlaylist(playlistId, playlist));
  registerIpcHandler('playlist:delete', (playlistId: number) => db.deletePlaylist(playlistId));
  registerIpcHandler('playlist:addSong', (playlistId: number, song: any) => db.addSongToPlaylist(playlistId, song));
  registerIpcHandler('playlist:removeSong', (playlistId: number, songId: string) => db.removeSongFromPlaylist(playlistId, songId));
  registerIpcHandler('playlist:getSongs', (playlistId: number) => db.getPlaylistSongs(playlistId));
  registerIpcHandler('playlist:updateSongsOrder', (playlistId: number, songId: string, order: number) => db.updatePlaylistSongOrder(playlistId, songId, order));
  registerIpcHandler('playlist:updateSongData', (playlistId: number, songId: string, songData: any) => db.updatePlaylistSongData(playlistId, songId, songData));
  registerIpcHandler('playlist:replaceSong', (playlistId: number, oldSongId: string, newSong: any) => db.replacePlaylistSong(playlistId, oldSongId, newSong));
  registerIpcHandler('playlist:reorderFull', async (playlistId: number, songIds: string[]) => {
    await db.reorderSongIds(playlistId, songIds);
  });
}
