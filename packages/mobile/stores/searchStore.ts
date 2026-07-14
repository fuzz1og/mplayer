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
      set({ results, loading: false, hasMore: results.some(g => g.songs.length > 0) });
    } catch (err) {
      console.error('搜索失败:', err);
      set({ loading: false, error: '搜索失败，请重试' });
    }
  },

  loadMore: async () => {
    const { loadingMore, hasMore, query, page, results } = get();
    if (loadingMore || !hasMore || !query.trim()) return;
    set({ loadingMore: true });
    try {
      const nextPage = page + 1;
      const source = useSourceStore.getState().selectedSource;
      let newResults: SongGroup[];
      if (source === 'all') {
        newResults = await musicApi.searchAllSources(query, nextPage);
      } else {
        const songs = await musicApi.searchSongs(query, nextPage, source as SourceKey);
        newResults = [{
          key: source,
          name: SOURCE_LABELS[source],
          artist: '',
          songs,
        }];
      }
      // 合并结果: 追加到对应源的分组 (不做去重, 保留同 ID 歌曲)
      const merged = results.map(g => {
        const same = newResults.find(n => n.key === g.key);
        return same ? { ...g, songs: [...g.songs, ...same.songs] } : g;
      });
      const hasMoreResults = newResults.some(g => g.songs.length > 0);
      set({ results: merged, page: nextPage, loadingMore: false, hasMore: hasMoreResults });
    } catch (err) {
      console.error('加载更多失败:', err);
      set({ loadingMore: false });
    }
  },

  clear: () => {
    set({ query: '', results: [], loading: false, error: null, page: 1, hasMore: true, loadingMore: false });
  },
}));
