import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Song } from '@mplayer/core';

interface FavoriteStore {
  favorites: Song[];
  addFavorite: (song: Song) => void;
  removeFavorite: (songId: string) => void;
  isFavorite: (songId: string) => boolean;
}

export const useFavoriteStore = create<FavoriteStore>()(
  persist(
    (set, get) => ({
      favorites: [],

      addFavorite: (song) => {
        set((state) => ({ favorites: [song, ...state.favorites] }));
      },

      removeFavorite: (songId) => {
        set((state) => ({
          favorites: state.favorites.filter((s) => s.id !== songId),
        }));
      },

      isFavorite: (songId) => {
        return get().favorites.some((s) => s.id === songId);
      },
    }),
    {
      name: 'favorites-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
