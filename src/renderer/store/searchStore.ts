import { create } from 'zustand';
import { dedupeSongs } from '@/renderer/utils/songDedupe';
import type { Song } from '@/shared/types/song';

export interface SearchState {
  songs: Song[];
  loading: boolean;
  hasMore: boolean;
  page: number;
  currentKeyword: string;
  sourceType: 'netease' | 'qq';
  error: string | null;
  setSongs: (songs: Song[], replace?: boolean) => void;
  setLoading: (loading: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setPage: (page: number) => void;
  setCurrentKeyword: (keyword: string) => void;
  setSourceType: (type: 'netease' | 'qq') => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  songs: [],
  loading: false,
  hasMore: true,
  page: 1,
  currentKeyword: '',
  sourceType: 'netease',
  error: null,

  setSongs: (songs: Song[], replace: boolean = true) => set((state) => {
    if (replace) {
      return { songs };
    } else {
      const uniqueSongs = dedupeSongs(state.songs, songs);
      return { songs: [...state.songs, ...uniqueSongs] };
    }
  }),
  setLoading: (loading: boolean) => set({ loading }),
  setHasMore: (hasMore: boolean) => set({ hasMore }),
  setPage: (page: number) => set({ page }),
  setCurrentKeyword: (keyword: string) => set({ currentKeyword: keyword }),
  setSourceType: (type: 'netease' | 'qq') => set({ sourceType: type }),
  setError: (error: string | null) => set({ error }),
  reset: () => set({
    songs: [],
    loading: false,
    hasMore: true,
    page: 1,
    currentKeyword: '',
    error: null
  })
}));
