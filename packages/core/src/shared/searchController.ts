import type { SongGroup } from '../types/index.js';
import { dedupeSongs } from '../utils/songDedupe.js';

export interface SearchControllerConfig {
  searchFn: (query: string, page: number, source: string) => Promise<SongGroup[]>;
  getState: () => Record<string, any>;
  setState: (partial: Record<string, any>) => void;
}

export interface SearchController {
  search: (query: string) => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
}

export function createSearchController(config: SearchControllerConfig): SearchController {
  const { searchFn, getState, setState } = config;
  let seq = 0;

  return {
    search: async (query: string) => {
      if (!query.trim()) return;
      const currentSeq = ++seq;
      setState({ loading: true, error: null, query, page: 1, results: [], hasMore: true });

      try {
        const { source } = getState() as { source: string };
        const results = await searchFn(query, 1, source);
        if (seq !== currentSeq) return; // stale
        setState({ results, loading: false, hasMore: results.some(g => g.songs.length > 0) });
      } catch {
        if (seq !== currentSeq) return;
        setState({ loading: false, error: '搜索失败，请重试' });
      }
    },

    loadMore: async () => {
      const state = getState() as { query?: string; page?: number; hasMore?: boolean; loading?: boolean; loadingMore?: boolean; results?: SongGroup[] };
      if (!state.query || !state.hasMore || state.loading || state.loadingMore) return;

      const currentSeq = seq;
      const currentPage = state.page || 1;
      const currentQuery = state.query;
      setState({ loadingMore: true });

      try {
        const nextPage = currentPage + 1;
        const { source } = getState() as { source: string };
        const newResults = await searchFn(currentQuery, nextPage, source);
        const s = getState() as { results?: SongGroup[]; query?: string; page?: number };
        // stale：清掉 loadingMore，否则新搜索后无限滚动永远被卡住
        if (seq !== currentSeq || s.query !== currentQuery) {
          setState({ loadingMore: false });
          return;
        }

        const existingKeys = new Set((s.results || []).map(g => g.key));
        const merged = (s.results || []).map(g => {
          const same = newResults.find(n => n.key === g.key);
          return same ? { ...g, songs: [...g.songs, ...dedupeSongs(g.songs, same.songs)] } : g;
        });
        for (const n of newResults) {
          if (!existingKeys.has(n.key)) merged.push(n);
        }
        const hasMoreResults = newResults.some(g => g.songs.length > 0);
        setState({ results: merged, page: nextPage, loadingMore: false, hasMore: hasMoreResults });
      } catch {
        if (seq !== currentSeq) return;
        setState({ loadingMore: false });
      }
    },

    reset: () => {
      seq++;
      setState({ query: '', results: [], loading: false, error: null, page: 1, hasMore: true, loadingMore: false });
    },
  };
}
