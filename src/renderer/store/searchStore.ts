import { create } from 'zustand';
import { dedupeSongs } from '@/renderer/utils/songDedupe';
import type { Song, SongGroup } from '@/shared/types/song';

type SingleSourceType = 'netease' | 'qq' | 'kugou' | 'migu' | 'kuwo' | 'qianqian' | 'soda';
export type SourceKey = SingleSourceType | 'all';

export interface SearchState {
  songs: Song[];
  loading: boolean;
  hasMore: boolean;
  page: number;
  currentKeyword: string;
  sourceType: SourceKey;
  error: string | null;
  groups: SongGroup[];
  expandedKeys: string[];
  setSongs: (songs: Song[], replace?: boolean) => void;
  setLoading: (loading: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setPage: (page: number) => void;
  setCurrentKeyword: (keyword: string) => void;
  setSourceType: (type: SourceKey) => void;
  setError: (error: string | null) => void;
  setGroups: (groups: SongGroup[], replace?: boolean) => void;
  toggleGroup: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  songs: [],
  loading: false,
  hasMore: true,
  page: 1,
  currentKeyword: '',
  sourceType: 'all',
  error: null,
  groups: [],
  expandedKeys: [],

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
  setSourceType: (type: SourceKey) => set({ sourceType: type }),
  setError: (error: string | null) => set({ error }),
  setGroups: (groups, replace = true) => set((state) => {
    if (replace) return { groups };
    const map = new Map<string, SongGroup>();
    for (const g of state.groups) map.set(g.key, { ...g, songs: [...g.songs] });
    for (const g of groups) {
      const existing = map.get(g.key);
      if (existing) {
        const existingIds = new Set<string>();
        for (const s of existing.songs) existingIds.add(s.id);
        const newSongs = g.songs.filter(s => !existingIds.has(s.id));
        existing.songs.push(...newSongs);
      } else {
        map.set(g.key, { ...g, songs: [...g.songs] });
      }
    }
    return { groups: Array.from(map.values()) };
  }),
  toggleGroup: (key) => set((state) => ({
    expandedKeys: state.expandedKeys.includes(key)
      ? state.expandedKeys.filter(k => k !== key)
      : [...state.expandedKeys, key],
  })),
  expandAll: () => set((state) => ({ expandedKeys: state.groups.map(g => g.key) })),
  collapseAll: () => set({ expandedKeys: [] }),
  reset: () => set({
    songs: [],
    groups: [],
    expandedKeys: [],
    sourceType: 'all',
    loading: false,
    hasMore: true,
    page: 1,
    currentKeyword: '',
    error: null,
  })
}));
