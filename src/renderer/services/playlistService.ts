import { ipcRenderer } from 'electron';
import type { Song, Playlist } from '@/shared/types/song';

export interface PlaylistService {
  createPlaylist(name: string, description?: string): Promise<number>;
  deletePlaylist(playlistId: number): Promise<void>;
  updatePlaylist(playlistId: number, updates: Partial<Playlist>): Promise<void>;
  getPlaylists(): Promise<Playlist[]>;
  getPlaylist(playlistId: number): Promise<Playlist | undefined>;
  addSongToPlaylist(playlistId: number, song: Song): Promise<number>;
  removeSongFromPlaylist(playlistId: number, songId: string): Promise<void>;
  getPlaylistSongs(playlistId: number): Promise<Song[]>;
  reorderPlaylistSongs(playlistId: number, songIds: string[]): Promise<void>;
}

class PlaylistServiceImpl implements PlaylistService {
  async createPlaylist(name: string, description?: string): Promise<number> {
    return ipcRenderer.invoke('playlist:create', name, description);
  }

  async deletePlaylist(playlistId: number): Promise<void> {
    return ipcRenderer.invoke('playlist:delete', playlistId);
  }

  async updatePlaylist(playlistId: number, updates: Partial<Playlist>): Promise<void> {
    const playlist = await this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error('歌单不存在');
    }
    return ipcRenderer.invoke('playlist:update', playlistId, { ...playlist, ...updates });
  }

  async getPlaylists(): Promise<Playlist[]> {
    return ipcRenderer.invoke('playlist:getAll');
  }

  async getPlaylist(playlistId: number): Promise<Playlist | undefined> {
    return ipcRenderer.invoke('playlist:get', playlistId);
  }

  async addSongToPlaylist(playlistId: number, song: Song): Promise<number> {
    const playlist = await this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error('歌单不存在');
    }
    return ipcRenderer.invoke('playlist:addSong', playlistId, song);
  }

  async removeSongFromPlaylist(playlistId: number, songId: string): Promise<void> {
    return ipcRenderer.invoke('playlist:removeSong', playlistId, songId);
  }

  async getPlaylistSongs(playlistId: number): Promise<Song[]> {
    const songs = await ipcRenderer.invoke('playlist:getSongs', playlistId);
    return songs as Song[];
  }

  async reorderPlaylistSongs(playlistId: number, songIds: string[]): Promise<void> {
    const songs = await this.getPlaylistSongs(playlistId);
    const songMap = new Map(songs.map(s => [s.id, s]));

    let order = 0;
    for (const songId of songIds) {
      const song = songMap.get(songId);
      if (song) {
        await this.updatePlaylistSongOrder(playlistId, songId, order);
        order++;
      }
    }
  }

  private async updatePlaylistSongOrder(playlistId: number, songId: string, order: number): Promise<void> {
    const songs = await this.getPlaylistSongs(playlistId);
    const songMap = new Map(songs.map(s => [s.id, s]));

    const song = songMap.get(songId);
    if (song) {
      await ipcRenderer.invoke('playlist:updateSongsOrder', playlistId, songId, order);
    }
  }
}

export const playlistService = new PlaylistServiceImpl();
