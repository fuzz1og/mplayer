import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Song } from '@mplayer/core';

interface FavoriteStore {
  favorites: Song[];
  favoriteIds: string[];
  addFavorite: (song: Song) => void;
  /**
   * 批量收藏（#490 歌单页选择模式）：一次 set = 一次持久化 + 一次渲染。
   * 已存在的 id 跳过（与 addFavorite 同语义，批量入参内部去重）。
   */
  addFavorites: (songs: Song[]) => void;
  removeFavorite: (songId: string) => void;
  replaceSong: (oldSongId: string, newSong: Song) => void;
  isFavorite: (songId: string) => boolean;
}

export const useFavoriteStore = create<FavoriteStore>()(
  persist(
    (set, get) => ({
      favorites: [],
      favoriteIds: [],

      addFavorite: (song) => {
        set((state) => {
          if (state.favoriteIds.includes(song.id)) return state;
          return {
            favorites: [song, ...state.favorites],
            favoriteIds: [song.id, ...state.favoriteIds],
          };
        });
      },

      addFavorites: (songs) => {
        set((state) => {
          const have = new Set(state.favoriteIds);
          const fresh: Song[] = [];
          for (const song of songs) {
            if (have.has(song.id)) continue;
            have.add(song.id);
            fresh.push(song);
          }
          if (fresh.length === 0) return state;
          const favorites = [...fresh, ...state.favorites];
          // 双数组不变量：favoriteIds 恒为 favorites 的 id 序列（与 addFavorite / removeFavorite 同一对）
          return { favorites, favoriteIds: favorites.map((s) => s.id) };
        });
      },

      removeFavorite: (songId) => {
        set((state) => ({
          favorites: state.favorites.filter((s) => s.id !== songId),
          favoriteIds: state.favoriteIds.filter((id) => id !== songId),
        }));
      },

      // 单曲换源后原位替换：收藏里的歌保持新源版本。
      // 旧 id 被替换（非新增）；若新 id 已存在于收藏（之前收藏过该源版本），
      // 去重保留一条，避免 FlatList key 冲突
      replaceSong: (oldSongId, newSong) => {
        set((state) => {
          const idx = state.favorites.findIndex((s) => s.id === oldSongId);
          if (idx < 0) return state;
          const others = state.favorites.filter((s) => s.id !== oldSongId && s.id !== newSong.id);
          const favorites = [...others.slice(0, idx), newSong, ...others.slice(idx)];
          return { favorites, favoriteIds: favorites.map((s) => s.id) };
        });
      },

      isFavorite: (songId) => {
        return get().favoriteIds.includes(songId);
      },
    }),
    {
      name: 'favorites-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
