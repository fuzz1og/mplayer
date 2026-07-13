import { create } from 'zustand';
import { musicApi } from '@mplayer/core';
import type { SongGroup } from '@mplayer/core';

interface SearchState {
  query: string;
  results: SongGroup[];
  loading: boolean;
  error: string | null;
  search: (query: string) => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  results: [],
  loading: false,
  error: null,

  search: async (query: string) => {
    if (!query.trim()) return;
    set({ query, loading: true, error: null });
    try {
      const results = await musicApi.searchAllSources(query);
      set({ results, loading: false });
    } catch (err) {
      console.error('搜索失败:', err);
      set({ loading: false, error: '搜索失败，请重试' });
    }
  },

  clear: () => {
    set({ query: '', results: [], loading: false, error: null });
  },
}));
