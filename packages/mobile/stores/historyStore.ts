import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Song } from '@mplayer/core';

const MAX_HISTORY = 200;

interface HistoryStore {
  history: Song[];
  addHistory: (song: Song) => void;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set) => ({
      history: [],

      addHistory: (song) => {
        set((state) => {
          const filtered = state.history.filter((s) => s.id !== song.id);
          return { history: [song, ...filtered].slice(0, MAX_HISTORY) };
        });
      },

      clearHistory: () => {
        set({ history: [] });
      },
    }),
    {
      name: 'history',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
