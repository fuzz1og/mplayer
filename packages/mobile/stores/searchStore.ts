import { create } from 'zustand';
import { musicApi, createSearchOrchestrator } from '@mplayer/core';
import type { SongGroup, SourceKey, SearchOrchestratorState } from '@mplayer/core';
import { useSourceStore, SOURCE_OPTION_LABELS, type SourceOption } from './sourceStore';
import { useLogsStore } from './logsStore';
import { probeSongsPrefetch } from '../services/songProbe';

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

/**
 * 搜索编排器（ADR-0003）：多源渐进/单源路由、seq 防 stale、组内合并全部
 * 单一事实来源地收编在 core SearchOrchestrator。Store 退化为纯绑定：
 * subscribe 镜像 + source 路由 + 完成后统一探测 + 日志。
 */
const orchestrator = createSearchOrchestrator<SourceKey>({
  // 模式感知搜索（T01）：auto 直连优先回退自建 API / direct 仅直连 / api 现状
  searchOneSource: (query, page, source) => musicApi.searchSongsRouted(query, page, source),
  // 并发 3：手机网络并发 >5 后严重劣化，渐进渲染下慢源稍后并入，体验不受影响
  concurrency: 3,
});

export const useSearchStore = create<SearchState>((set, get) => {
  /**
   * subscribe 镜像：编排器状态 → zustand。单源结果按所选源映射中文名
   * （编排器结果组 name = 源 key，渲染层 SingleSourceResults 用它作标题）。
   */
  const mirror = (o: SearchOrchestratorState): void => {
    const selected = useSourceStore.getState().selectedSource;
    let results = o.results;
    if (selected !== 'all' && results.length > 0) {
      results = results.map((g) => ({ ...g, name: SOURCE_OPTION_LABELS[selected as SourceOption] ?? g.name }));
    }
    set({
      results,
      loading: o.loading,
      loadingMore: o.loadingMore,
      hasMore: o.hasMore,
      page: o.page,
      query: o.query,
      error: o.error,
    });
  };
  orchestrator.subscribe(mirror);

  return {
    query: '',
    results: [],
    loading: false,
    error: null,
    page: 1,
    hasMore: true,
    loadingMore: false,

    search: async (query: string) => {
      const source = useSourceStore.getState().selectedSource;
      const route: SourceKey | 'all' = source === 'all' ? 'all' : (source as SourceKey);
      const t0 = Date.now();
      await orchestrator.search(query, route);
      useLogsStore.getState().addLog('info', `搜索完成: 词「${query}」耗时 ${Date.now() - t0}ms`);
      // 探测在全部完成后统一跑（与搜索并发会抢手机网络带宽）
      const { results } = get();
      if (results.length > 0) {
        await probeSongsPrefetch(results.flatMap((g) => g.songs));
      }
    },

    loadMore: async () => {
      await orchestrator.loadMore();
    },

    clear: () => {
      orchestrator.reset();
    },
  };
});
