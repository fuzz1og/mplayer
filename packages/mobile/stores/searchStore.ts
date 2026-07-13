import { create } from 'zustand';
import { musicApi } from '@mplayer/core';
import type { SongGroup } from '@mplayer/core';

interface SearchState {
  query: string;
  results: SongGroup[];
  loading: boolean;
  search: (query: string) => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  results: [],
  loading: false,

  search: async (query: string) => {
    if (!query.trim()) return;
    set({ query, loading: true });
    try {
      const results = await musicApi.searchAllSources(query);
      set({ results, loading: false });
    } catch (err) {
      console.error('搜索失败:', err);
      set({ loading: false });
    }
  },

  clear: () => {
    set({ query: '', results: [], loading: false });
  },
}));
