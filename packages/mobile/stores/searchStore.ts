import { create } from 'zustand';
import { musicApi } from '@mplayer/core';
import type { SongGroup, SourceKey } from '@mplayer/core';
import { useSourceStore } from './sourceStore';
import type { SourceOption } from './sourceStore';

const SOURCE_LABELS: Record<SourceOption, string> = {
  all: '全部',
  netease: '网易云',
  qq: 'QQ音乐',
  kugou: '酷狗',
  migu: '咪咕',
  kuwo: '酷我',
  qianqian: '千千',
  soda: '汽水',
  local: '本地',
};

let searchSeq = 0;

interface SearchState {
  query: string;
  results: SongGroup[];
  loading: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
  search: (query: string) => Promise<void>;
  loadMore: () => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  results: [],
  loading: false,
  error: null,
  page: 1,
  hasMore: true,
  loadingMore: false,

  search: async (query: string) => {
    if (!query.trim()) return;
    const seq = ++searchSeq;
    set({ query, loading: true, error: null, results: [], page: 1, hasMore: true });
    try {
      const source = useSourceStore.getState().selectedSource;
      let results: SongGroup[];
      if (source === 'all') {
        results = await musicApi.searchAllSources(query, 1);
      } else {
        const songs = await musicApi.searchSongs(query, 1, source as SourceKey);
        results = [{
          key: source,
          name: SOURCE_LABELS[source],
          artist: '',
          songs,
        }];
      }
      if (searchSeq !== seq) return; // 有更新查询，丢弃此结果
      set({ results, loading: false, hasMore: results.some(g => g.songs.length > 0) });
    } catch (err) {
      if (searchSeq !== seq) return;
      console.error('搜索失败:', err);
      set({ loading: false, error: '搜索失败，请重试' });
    }
  },

  loadMore: async () => {
    const state = get();
    if (state.loadingMore || !state.hasMore || !state.query.trim()) return;
    set({ loadingMore: true });
    const seq = searchSeq;
    const currentQuery = state.query;
    const currentPage = state.page;
    try {
      const nextPage = currentPage + 1;
      const source = useSourceStore.getState().selectedSource;
      let newResults: SongGroup[];
      if (source === 'all') {
        newResults = await musicApi.searchAllSources(currentQuery, nextPage);
      } else {
        const songs = await musicApi.searchSongs(currentQuery, nextPage, source as SourceKey);
        newResults = [{
          key: source,
          name: SOURCE_LABELS[source],
          artist: '',
          songs,
        }];
      }
      const s = get();
      if (searchSeq !== seq || s.query !== currentQuery) return; // 查询已重置

      // 合并: 保留现有分组，追加同组，新增不在当前结果里的组
      const existingKeys = new Set(s.results.map(g => g.key));
      const merged = s.results.map(g => {
        const same = newResults.find(n => n.key === g.key);
        return same ? { ...g, songs: [...g.songs, ...same.songs] } : g;
      });
      for (const n of newResults) {
        if (!existingKeys.has(n.key)) {
          merged.push(n);
        }
      }
      const hasMoreResults = newResults.some(g => g.songs.length > 0);
      set({ results: merged, page: nextPage, loadingMore: false, hasMore: hasMoreResults });
    } catch (err) {
      if (searchSeq !== seq) return;
      console.error('加载更多失败:', err);
      set({ loadingMore: false });
    }
  },

  clear: () => {
    searchSeq++;
    set({ query: '', results: [], loading: false, error: null, page: 1, hasMore: true, loadingMore: false });
  },
}));
