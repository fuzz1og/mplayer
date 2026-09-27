import { create } from 'zustand';
import { dedupeSongs } from '@mplayer/core';
import type { Song, SongGroup, AudioTag, SourceKey as CoreSourceKey } from '@mplayer/core';

type SingleSourceType = CoreSourceKey;
export type SourceKey = SingleSourceType | 'all';

export interface SearchState {
  songs: Song[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  page: number;
  currentKeyword: string;
  sourceType: SourceKey;
  /** 搜索结果初始 tab：普通搜索落在单曲；「查看歌手」入口落在歌手 */
  preferredTab: 'songs' | 'artists';
  error: string | null;
  groups: SongGroup[];
  expandedKeys: string[];
  setSongs: (songs: Song[], replace?: boolean) => void;
  setLoading: (loading: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setPage: (page: number) => void;
  setCurrentKeyword: (keyword: string) => void;
  setSourceType: (type: SourceKey) => void;
  setPreferredTab: (tab: 'songs' | 'artists') => void;
  setError: (error: string | null) => void;
  setGroups: (groups: SongGroup[], replace?: boolean) => void;
  setAudioTag: (songId: string, tag: AudioTag) => void;
  toggleGroup: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  songs: [],
  loading: false,
  loadingMore: false,
  hasMore: true,
  page: 1,
  currentKeyword: '',
  sourceType: 'all',
  preferredTab: 'songs',
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
  setPreferredTab: (tab) => set({ preferredTab: tab }),
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
  setAudioTag: (songId: string, tag: AudioTag) => set((state) => {
    // Update in flat songs array
    const songIndex = state.songs.findIndex(s => s.id === songId);
    if (songIndex !== -1) {
      const newSongs = [...state.songs];
      newSongs[songIndex] = { ...newSongs[songIndex], audioTag: tag };
      return { songs: newSongs };
    }

    // 分组视图：**只重建真正包含这首歌的那些组**（#412）。
    // 此前无论命中与否都把整份 groups 全量 map 一遍（每首歌都新建对象）——
    // 一次「播放成功」事件就能让整表换新，订阅 groups 的组件全部重渲染。
    // 注意不能只取第一个命中组：同一首歌可以合法出现在多个组里。
    let hit = false;
    const newGroups = state.groups.map(group => {
      if (!group.songs.some(s => s.id === songId)) return group; // 未命中的组保持同一引用
      hit = true;
      return {
        ...group,
        songs: group.songs.map(s => (s.id === songId ? { ...s, audioTag: tag } : s)),
      };
    });
    if (!hit) return {}; // 一处都没命中：state 不变，不惊动任何订阅者

    return { groups: newGroups };
  }),
  toggleGroup: (key) => set((state) => ({
    expandedKeys: state.expandedKeys.includes(key)
      ? state.expandedKeys.filter(k => k !== key)
      : [...state.expandedKeys, key],
  })),
  expandAll: () => set((state) => ({ expandedKeys: state.groups.map(g => g.key) })),
  collapseAll: () => set({ expandedKeys: [] }),
  reset: () => set((state) => ({
    songs: [],
    groups: [],
    expandedKeys: [],
    sourceType: state.sourceType,
    loading: false,
    loadingMore: false,
    hasMore: true,
    page: 1,
    currentKeyword: '',
    preferredTab: 'songs',
    error: null,
  }))
}));
