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

      // 单曲换源后原位替换：收藏里的歌保持新源版本（新 id 同步进 favoriteIds，
      // 换源后 SongRow 的收藏红心状态仍正确）
      replaceSong: (oldSongId, newSong) => {
        set((state) => ({
          favorites: state.favorites.map((s) => (s.id === oldSongId ? newSong : s)),
          favoriteIds: state.favoriteIds.map((id) => (id === oldSongId ? newSong.id : id)),
        }));
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
