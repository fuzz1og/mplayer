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

  // 防抖写入机制
  private isDirty: boolean = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DELAY: number = 200; // 200ms 防抖延迟

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
    try {
      if (fs.existsSync(this.dataFile)) {
        const jsonData = fs.readFileSync(this.dataFile, 'utf-8');
        const parsedData = JSON.parse(jsonData);

        // 验证数据完整性
        if (!this.validateDataIntegrity(parsedData)) {
          throw new Error('数据完整性验证失败');
        }

        // 转换日期字符串为Date对象
        this.data = this.convertDates(parsedData);
      } else {
        this.data = this.getInitialData();
      }
    } catch (error) {
      console.error('加载数据失败，使用默认数据:', error);
      this.data = this.getInitialData();
    }
  }

  private async saveData(): Promise<void> {
    if (!this.initialized) return;

    // 标记为脏数据
    this.isDirty = true;

    // 清除之前的定时器（防抖）
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // 设置新的定时器
    this.saveTimer = setTimeout(async () => {
      try {
        if (this.isDirty) {
          await this.writeWithTransaction(this.data);
          this.isDirty = false;
        }
      } catch (error) {
        console.error('防抖写入失败:', error);
      } finally {
        this.saveTimer = null;
      }
    }, this.SAVE_DELAY);
  }

  /**
   * 立即写入数据（用于应用退出时）
   * 跳过防抖机制，确保数据不丢失
   */
  async flushSave(): Promise<void> {
    if (!this.initialized) return;

    // 清除防抖定时器
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // 如果有脏数据，立即写入
    if (this.isDirty) {
      try {
        await this.writeWithTransaction(this.data);
        this.isDirty = false;
      } catch (error) {
        console.error('立即写入失败:', error);
        throw error;
      }
    }
  }

  private writeWithTransaction(data: StorageData): Promise<void> {
    const tempPath = this.dataFile + '.tmp';
    const backupPath = this.dataFile + '.backup';

    return new Promise((resolve, reject) => {
      try {
        // 1. 创建当前文件的备份
        if (fs.existsSync(this.dataFile)) {
          fs.copyFileSync(this.dataFile, backupPath);
        }

        // 2. 写入临时文件
        const jsonData = JSON.stringify(data, null, 2);
        fs.writeFileSync(tempPath, jsonData, 'utf-8');

        // 3. 确保临时文件写入成功
        if (!fs.existsSync(tempPath)) {
          throw new Error('临时文件写入失败');
        }

        // 4. 原子性替换原文件
        fs.renameSync(tempPath, this.dataFile);

        // 5. 清理备份文件（可选，可保留作为历史备份）
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }

        resolve();

      } catch (error) {
        // 发生错误时尝试恢复备份
        if (fs.existsSync(backupPath)) {
          try {
            fs.renameSync(backupPath, this.dataFile);
          } catch (restoreError) {
            console.error('数据恢复失败:', restoreError);
          }
        }

        // 清理临时文件
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        reject(error);
      }
    });
  }

  private validateDataIntegrity(data: StorageData): boolean {
    // 验证基本数据结构
    if (!data || typeof data !== 'object') return false;

    const requiredKeys = ['favorites', 'playHistory', 'playlists', 'playlistSongs', 'settings'];
    for (const key of requiredKeys) {
      if (!(key in data)) return false;
    }

    // 验证数组类型
    if (!Array.isArray(data.favorites) ||
        !Array.isArray(data.playHistory) ||
        !Array.isArray(data.playlists) ||
        !Array.isArray(data.playlistSongs)) {
      return false;
    }

    // 验证settings对象
    if (typeof data.settings !== 'object') return false;

    return true;
  }

  private convertDates(data: any): StorageData {
    const converted = {
      favorites: (data.favorites || []).map((f: any) => ({
        ...f,
        createdAt: new Date(f.createdAt)
      })),
      playHistory: (data.playHistory || []).map((h: any) => ({
        ...h,
        playedAt: new Date(h.playedAt)
      })),
      playlists: (data.playlists || []).map((p: any) => ({
        ...p,
        createdAt: new Date(p.createdAt)
      })),
      playlistSongs: data.playlistSongs || [],
      settings: data.settings || {}
    };

    return converted as StorageData;
  }

  private getInitialData(): StorageData {
    return {
      favorites: [],
      playHistory: [],
      playlists: [],
      playlistSongs: [],
      settings: {}
    };
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
    await this.saveData();
    return id;
  }

  async updateFavoriteSongData(songId: string, songData: Partial<Song>): Promise<void> {
    const favorite = this.data.favorites.find(f => f.songId === songId);
    if (favorite) {
      favorite.song = { ...favorite.song, ...songData } as SongBase;
      await this.saveData();
    }
  }

  async removeFavorite(songId: string): Promise<void> {
    this.data.favorites = this.data.favorites.filter(f => f.songId !== songId);
    await this.saveData();
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
    const songBase: SongBase = {
      id: song.id,
      name: song.name,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      sourceType: song.sourceType
    };
    const historyItem: PlayHistory = {
      id,
      songId: song.id,
      song: songBase,
      playedAt: new Date()
    };

    this.data.playHistory.push(historyItem);
    await this.saveData();
    return id;
  }

  async getPlayHistory(limit: number = 50): Promise<PlayHistory[]> {
    return this.data.playHistory
      .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())
      .slice(0, limit);
  }

  async clearPlayHistory(): Promise<void> {
    this.data.playHistory = [];
    await this.saveData();
  }

  async removeFromPlayHistory(songId: string): Promise<void> {
    this.data.playHistory = this.data.playHistory.filter(h => h.songId !== songId);
    await this.saveData();
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
    await this.saveData();
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
      await this.saveData();
    }
  }

  async deletePlaylist(playlistId: number): Promise<void> {
    // 验证歌单是否存在
    const playlist = this.data.playlists.find(p => p.id === playlistId);
    if (!playlist) {
      throw new Error(`歌单不存在: ${playlistId}`);
    }

    // 执行事务性删除
    try {
      // 1. 删除歌单歌曲关联
      this.data.playlistSongs = this.data.playlistSongs.filter(ps => ps.playlistId !== playlistId);

      // 2. 删除歌单本身
      this.data.playlists = this.data.playlists.filter(p => p.id !== playlistId);

      // 3. 保存更改
      await this.saveData();
    } catch (error) {
      console.error('删除歌单失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`删除歌单失败: ${errorMessage}`);
    }
  }

  // Playlist Songs
  async addSongToPlaylist(playlistId: number, song: Song): Promise<number> {
    // 验证歌单是否存在
    const playlist = this.data.playlists.find(p => p.id === playlistId);
    if (!playlist) {
      throw new Error(`歌单不存在: ${playlistId}`);
    }

    // 验证歌曲数据完整性
    if (!this.validateSongData(song)) {
      throw new Error('歌曲数据不完整');
    }

    // 检查歌曲是否已经存在于歌单中
    const existing = this.data.playlistSongs.find(
      ps => ps.playlistId === playlistId && ps.songId === song.id
    );
    if (existing) {
      return existing.id!;
    }

    // 检查歌单容量限制（可选）
    const currentSongs = this.data.playlistSongs.filter(ps => ps.playlistId === playlistId);
    if (currentSongs.length >= 1000) { // 限制1000首歌
      throw new Error('歌单已达到最大容量限制');
    }

    const maxOrder = currentSongs.reduce((max, ps) => Math.max(max, ps.order), -1);

    const id = Date.now();
    const playlistSong: PlaylistSong = {
      id,
      playlistId,
      songId: song.id,
      song: song as Song,
      order: maxOrder + 1
    };

    this.data.playlistSongs.push(playlistSong);
    await this.saveData();
    return id;
  }

  private validateSongData(song: Song): boolean {
    return !!(song.id && song.name && song.artist && song.url);
  }

  async removeSongFromPlaylist(playlistId: number, songId: string): Promise<void> {
    this.data.playlistSongs = this.data.playlistSongs.filter(
      ps => !(ps.playlistId === playlistId && ps.songId === songId)
    );
    await this.saveData();
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
      await this.saveData();
    }
  }

  async updatePlaylistSongData(playlistId: number, songId: string, songData: Partial<Song>): Promise<void> {
    const item = this.data.playlistSongs.find(
      ps => ps.playlistId === playlistId && ps.songId === songId
    );
    if (item) {
      item.song = { ...item.song, ...songData } as Song;
      await this.saveData();
    }
  }

  async reorderSongIds(playlistId: number, songIds: string[]): Promise<void> {
    const existing = this.data.playlistSongs.filter(ps => ps.playlistId === playlistId);
    const existingMap = new Map(existing.map(ps => [ps.songId, ps]));

    const newPlaylistSongs = songIds.map((songId, index) => {
      const existingItem = existingMap.get(songId);
      if (existingItem) {
        return { ...existingItem, order: index };
      }
      return null;
    }).filter(Boolean) as PlaylistSong[];

    const remainingIds = new Set(songIds);
    const remaining = existing.filter(ps => !remainingIds.has(ps.songId));
    const allSongs = [...newPlaylistSongs, ...remaining];

    this.data.playlistSongs = this.data.playlistSongs.filter(ps => ps.playlistId !== playlistId);
    this.data.playlistSongs.push(...allSongs);
    await this.saveData();
  }

  // Settings
  async setSetting<T>(key: string, value: T): Promise<void> {
    this.ensureInitialized();
    this.data.settings[key] = value;
    // 设置项需要立即写入磁盘，避免防抖导致重启后丢失
    await this.writeWithTransaction(this.data);
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
