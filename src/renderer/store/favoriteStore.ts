import { create } from 'zustand';
import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song, SongBase } from '@mplayer/core';

interface FavoriteState {
  favoriteIds: string[];
  favorites: Song[];
  loading: boolean;
  error: string | null;

  // Actions
  loadFavorites: () => Promise<void>;
  toggleFavorite: (song: Song) => Promise<boolean>;
  isFavorite: (songId: string) => boolean;
  addFavorite: (song: Song) => Promise<void>;
  removeFavorite: (songId: string) => Promise<void>;
  /** 单曲换源：原位替换收藏（保持收藏时间与排序） */
  replaceFavorite: (originalId: string, swapped: Song) => Promise<void>;
}

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  favoriteIds: [],
  favorites: [],
  loading: false,
  error: null,

  loadFavorites: async () => {
    set({ loading: true, error: null });
    try {
      const songBases = await IpcClient.invoke<SongBase[]>('favorite:getAll');
      // 挂载整表扫荡已退役（#317）：收藏直接上屏——url/歌词由播放/歌词链路
      // 懒解析补，空封面行由行级 songCoverRefresh 懒兜底
      set({
        favorites: songBases as Song[],
        favoriteIds: songBases.map(s => s.id),
        loading: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '加载收藏失败',
        loading: false
      });
    }
  },

  toggleFavorite: async (song: Song) => {
    const { favoriteIds } = get();
    const isCurrentlyFavorite = favoriteIds.includes(song.id);

    try {
      if (isCurrentlyFavorite) {
        await IpcClient.invoke<void>('favorite:remove', song.id);
        set((state) => {
          const newIds = state.favoriteIds.filter(id => id !== song.id);
          const newFavorites = state.favorites.filter(f => f.id !== song.id);
          return { favoriteIds: newIds, favorites: newFavorites };
        });
        return false;
      } else {
        await IpcClient.invoke<number>('favorite:add', song);
        set((state) => {
          const newIds = [...state.favoriteIds, song.id];
          const newFavorites = [...state.favorites, song];
          return { favoriteIds: newIds, favorites: newFavorites };
        });
        return true;
      }
    } catch (error) {
      console.error('收藏操作失败:', error);
      throw error;
    }
  },

  isFavorite: (songId: string) => {
    return get().favoriteIds.includes(songId);
  },

  addFavorite: async (song: Song) => {
    const { favoriteIds } = get();
    if (favoriteIds.includes(song.id)) return;

    try {
      await IpcClient.invoke<number>('favorite:add', song);
      set((state) => {
        const newIds = [...state.favoriteIds, song.id];
        const newFavorites = [...state.favorites, song];
        return { favoriteIds: newIds, favorites: newFavorites };
      });
    } catch (error) {
      console.error('添加收藏失败:', error);
      throw error;
    }
  },

  removeFavorite: async (songId: string) => {
    const { favoriteIds } = get();
    if (!favoriteIds.includes(songId)) return;

    try {
      await IpcClient.invoke<void>('favorite:remove', songId);
      set((state) => {
        const newIds = state.favoriteIds.filter(id => id !== songId);
        const newFavorites = state.favorites.filter(f => f.id !== songId);
        return { favoriteIds: newIds, favorites: newFavorites };
      });
    } catch (error) {
      console.error('移除收藏失败:', error);
      throw error;
    }
  },

  replaceFavorite: async (originalId: string, swapped: Song) => {
    try {
      await IpcClient.invoke<void>('favorite:replaceSong', originalId, swapped);
      set((state) => ({
        favorites: state.favorites.map(f => f.id === originalId ? swapped : f),
        favoriteIds: state.favoriteIds.map(id => id === originalId ? swapped.id : id),
      }));
    } catch (error) {
      console.error('换源保存到收藏失败:', error);
      throw error;
    }
  },
}));
