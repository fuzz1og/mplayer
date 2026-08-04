import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Song } from '@mplayer/core';

interface FavoriteStore {
  favorites: Song[];
  favoriteIds: string[];
  addFavorite: (song: Song) => void;
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
