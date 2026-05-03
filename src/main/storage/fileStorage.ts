import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { Song, SongBase, Favorite, PlayHistory, Playlist, PlaylistSong } from '@/shared/types/song';

interface StorageData {
  favorites: Favorite[];
  playHistory: PlayHistory[];
  playlists: Playlist[];
  playlistSongs: PlaylistSong[];
  settings: Record<string, any>;
}

class FileStorage {
  private dataDir: string = '';
  private dataFile: string = '';
  private data: StorageData = {
    favorites: [],
    playHistory: [],
    playlists: [],
    playlistSongs: [],
    settings: {}
  };
  private initialized: boolean = false;

  private ensureInitialized(): void {
    if (this.initialized) return;
    const userDataPath = app.getPath('userData');
    this.dataDir = path.join(userDataPath, 'data');
    this.dataFile = path.join(this.dataDir, 'storage.json');
    this.init();
    this.initialized = true;
  }

  private init(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.loadData();
  }

  private loadData(): void {
    if (fs.existsSync(this.dataFile)) {
      try {
        const fileContent = fs.readFileSync(this.dataFile, 'utf-8');
        const loadedData = JSON.parse(fileContent);
        this.data = {
          favorites: loadedData.favorites || [],
          playHistory: loadedData.playHistory || [],
          playlists: loadedData.playlists || [],
          playlistSongs: loadedData.playlistSongs || [],
          settings: loadedData.settings || {}
        };
        this.data.favorites.forEach(f => f.createdAt = new Date(f.createdAt));
        this.data.playHistory.forEach(h => h.playedAt = new Date(h.playedAt));
        this.data.playlists.forEach(p => p.createdAt = new Date(p.createdAt));
      } catch (error) {
        console.error('加载数据失败:', error);
      }
    }
  }

  private saveData(): void {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('保存数据失败:', error);
    }
  }

  // Favorites
  async addFavorite(song: Song): Promise<number> {
    const existing = this.data.favorites.find(f => f.songId === song.id);
    if (existing) {
      return existing.id!;
    }

    const id = Date.now();
    const favorite: Favorite = {
      id,
      songId: song.id,
      song: {
        id: song.id,
        name: song.name,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        sourceType: song.sourceType
      },
      createdAt: new Date()
    };

    this.data.favorites.push(favorite);
    this.saveData();
    return id;
  }

  async removeFavorite(songId: string): Promise<void> {
    this.data.favorites = this.data.favorites.filter(f => f.songId !== songId);
    this.saveData();
  }

  async isFavorite(songId: string): Promise<boolean> {
    return this.data.favorites.some(f => f.songId === songId);
  }

  async getFavorites(): Promise<SongBase[]> {
    return this.data.favorites
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(f => f.song);
  }

  // Play History
  async addToPlayHistory(song: Song): Promise<number> {
    const id = Date.now();
    const historyItem: PlayHistory = {
      id,
      songId: song.id,
      song: song,
      playedAt: new Date()
    };

    this.data.playHistory.push(historyItem);
    this.saveData();
    return id;
  }

  async getPlayHistory(limit: number = 50): Promise<PlayHistory[]> {
    return this.data.playHistory
      .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())
      .slice(0, limit);
  }

  async clearPlayHistory(): Promise<void> {
    this.data.playHistory = [];
    this.saveData();
  }

  async removeFromPlayHistory(songId: string): Promise<void> {
    this.data.playHistory = this.data.playHistory.filter(h => h.songId !== songId);
    this.saveData();
  }

  // Playlists
  async createPlaylist(name: string, description?: string): Promise<number> {
    const id = Date.now();
    const playlist: Playlist = {
      id,
      name,
      description,
      createdAt: new Date()
    };

    this.data.playlists.push(playlist);
    this.saveData();
    return id;
  }

  async getPlaylists(): Promise<Playlist[]> {
    return this.data.playlists
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getPlaylist(playlistId: number): Promise<Playlist | undefined> {
    return this.data.playlists.find(p => p.id === playlistId);
  }

  async updatePlaylist(playlistId: number, playlist: Partial<Playlist>): Promise<void> {
    const index = this.data.playlists.findIndex(p => p.id === playlistId);
    if (index !== -1) {
      this.data.playlists[index] = { ...this.data.playlists[index], ...playlist };
      this.saveData();
    }
  }

  async deletePlaylist(playlistId: number): Promise<void> {
    this.data.playlists = this.data.playlists.filter(p => p.id !== playlistId);
    this.data.playlistSongs = this.data.playlistSongs.filter(ps => ps.playlistId !== playlistId);
    this.saveData();
  }

  // Playlist Songs
  async addSongToPlaylist(playlistId: number, song: Song): Promise<number> {
    // 检查歌曲是否已经存在于歌单中
    const existing = this.data.playlistSongs.find(
      ps => ps.playlistId === playlistId && ps.songId === song.id
    );
    if (existing) {
      return existing.id!;
    }

    const maxOrder = this.data.playlistSongs
      .filter(ps => ps.playlistId === playlistId)
      .reduce((max, ps) => Math.max(max, ps.order), -1);

    const id = Date.now();
    const playlistSong: PlaylistSong = {
      id,
      playlistId,
      songId: song.id,
      song: song as Song,
      order: maxOrder + 1
    };

    this.data.playlistSongs.push(playlistSong);
    this.saveData();
    return id;
  }

  async removeSongFromPlaylist(playlistId: number, songId: string): Promise<void> {
    this.data.playlistSongs = this.data.playlistSongs.filter(
      ps => !(ps.playlistId === playlistId && ps.songId === songId)
    );
    this.saveData();
  }

  async getPlaylistSongs(playlistId: number): Promise<SongBase[]> {
    return this.data.playlistSongs
      .filter(ps => ps.playlistId === playlistId)
      .sort((a, b) => a.order - b.order)
      .map(ps => ps.song);
  }

  async updatePlaylistSongOrder(playlistId: number, songId: string, order: number): Promise<void> {
    const item = this.data.playlistSongs.find(
      ps => ps.playlistId === playlistId && ps.songId === songId
    );
    if (item) {
      item.order = order;
      this.saveData();
    }
  }

  // Settings
  async setSetting<T>(key: string, value: T): Promise<void> {
    this.ensureInitialized();
    this.data.settings[key] = value;
    this.saveData();
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    this.ensureInitialized();
    return this.data.settings[key] as T | undefined;
  }

  // 同步方法，供 config.ts 使用
  getSettingSync<T>(key: string): T | undefined {
    try {
      this.ensureInitialized();
    } catch {
      // app 未 ready，返回 undefined
      return undefined;
    }
    return this.data.settings[key] as T | undefined;
  }
}

let fileStorageInstance: FileStorage | null = null;

export function getFileStorage(): FileStorage {
  if (!fileStorageInstance) {
    fileStorageInstance = new FileStorage();
  }
  return fileStorageInstance;
}
