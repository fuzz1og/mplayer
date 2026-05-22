import { IpcClient } from './IpcClient';
import type { Song, SongBase } from '@/shared/types/song';

export interface FavoriteService {
  addFavorite(song: Song): Promise<number>;
  removeFavorite(songId: string): Promise<void>;
  isFavorite(songId: string): Promise<boolean>;
  getFavorites(): Promise<SongBase[]>;
  toggleFavorite(song: Song): Promise<boolean>;
}

class FavoriteServiceImpl implements FavoriteService {
  async addFavorite(song: Song): Promise<number> {
    const isAlreadyFavorite = await this.isFavorite(song.id);
    if (isAlreadyFavorite) {
      throw new Error('歌曲已在收藏列表中');
    }
    return IpcClient.invoke<number>('favorite:add', song);
  }

  async removeFavorite(songId: string): Promise<void> {
    return IpcClient.invoke<void>('favorite:remove', songId);
  }

  async isFavorite(songId: string): Promise<boolean> {
    return IpcClient.invoke<boolean>('favorite:isFavorite', songId);
  }

  async getFavorites(): Promise<SongBase[]> {
    return IpcClient.invoke<SongBase[]>('favorite:getAll');
  }

  async toggleFavorite(song: Song): Promise<boolean> {
    const isFav = await this.isFavorite(song.id);
    if (isFav) {
      await this.removeFavorite(song.id);
      return false;
    } else {
      await this.addFavorite(song);
      return true;
    }
  }
}

export const favoriteService = new FavoriteServiceImpl();
