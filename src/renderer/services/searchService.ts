import type { Artist, SearchOrchestratorState } from '@mplayer/core';
import { createSearchOrchestrator } from '@mplayer/core';
import type { SourceKey as CoreSourceKey } from '@mplayer/core';
import { useSearchStore } from '@/renderer/store/searchStore';
import { callMusicApi } from './callMusicApi';

const DEBOUNCE_DELAY = 300;

/**
 * 桌面搜索服务：SearchOrchestrator（ADR-0003）映射到 zustand searchStore。
 * 编排器自持状态/seq/组内合并（单一事实来源），本服务只做：
 * - source 路由（sourceType → route）
 * - subscribe 镜像（编排器状态 → store 的 groups/songs/currentKeyword/loading…）
 *
 * #391：搜索结果的批量直连探测（probeSongsBatch 20/批）已删除——它是整列表扇出
 * （整榜 ≤200 首 → ~400 请求），且判据反向、产物无消费者。预解析改由「队列下一首
 * 预取 / 冷启预热」经 `prefetchPlayableSong` 门面完成（含 tier3、O(1) 成本）。
 */
class SearchService {
  private debounceTimer: NodeJS.Timeout | null = null;
  private orchestrator = createSearchOrchestrator<CoreSourceKey>({
    searchOneSource: (query, page, source) => callMusicApi('searchSongsRouted', query, page, source),
    // 桌面并发 3：直连源对并发敏感，降低同时请求数避免风控/限流
    concurrency: 3,
  });
  constructor() {
    this.orchestrator.subscribe((o) => this.applyOrchestratorState(o));
  }

  private applyOrchestratorState(o: SearchOrchestratorState): void {
    const store = useSearchStore.getState();
    const updates: Record<string, unknown> = {
      loading: o.loading,
      loadingMore: o.loadingMore,
      error: o.error,
      hasMore: o.hasMore,
      page: o.page,
    };
    if (o.query !== undefined && o.query !== store.currentKeyword) updates.currentKeyword = o.query;
    if (o.results) {
      if (store.sourceType === 'all') {
        updates.groups = o.results;
      } else {
        updates.songs = o.results.flatMap((g) => g.songs);
      }
    }
    useSearchStore.setState(updates as any);
  }

  debouncedSearch(keyword: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.search(keyword);
    }, DEBOUNCE_DELAY);
  }

  search(keyword: string): Promise<void> {
    const { sourceType } = useSearchStore.getState();
    const route: 'all' | CoreSourceKey = sourceType === 'all' ? 'all' : (sourceType as CoreSourceKey);
    return this.orchestrator.search(keyword, route);
  }

  searchAll(keyword: string): void {
    useSearchStore.setState({ sourceType: 'all' } as any);
    void this.orchestrator.search(keyword, 'all');
  }

  /**
   * 搜索歌手（仅网易云源有歌手搜索接口）：结果由调用方持有，
   * 搜索结果页的「歌手」tab 用它加载。
   */
  async searchArtists(keyword: string, limit = 30): Promise<Artist[]> {
    return callMusicApi('searchArtists', 'netease', keyword, limit);
  }

  loadMore(): Promise<void> {
    return this.orchestrator.loadMore();
  }

  reset(): void {
    this.orchestrator.reset();
  }
}

export const searchService = new SearchService();
