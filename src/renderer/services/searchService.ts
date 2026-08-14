import type { Song, SongGroup, ImportSource, Artist, SearchOrchestratorState } from '@mplayer/core';
import { createSearchOrchestrator } from '@mplayer/core';
import type { SourceKey as CoreSourceKey } from '@mplayer/core';
import { useSearchStore } from '@/renderer/store/searchStore';
import { callMusicApi } from './callMusicApi';

const DEBOUNCE_DELAY = 300;
const PROBE_BATCH_SIZE = 20;

/**
 * 桌面搜索服务：SearchOrchestrator（ADR-0003）映射到 zustand searchStore。
 * 编排器自持状态/seq/组内合并（单一事实来源），本服务只做：
 * - source 路由（sourceType → route）
 * - subscribe 镜像（编排器状态 → store 的 groups/songs/currentKeyword/loading…）
 * - 探测副作用（逐批 probeResults，增量去重，避免对渐进程中已探测的源重复探测）
 */
class SearchService {
  private debounceTimer: NodeJS.Timeout | null = null;
  private orchestrator = createSearchOrchestrator<CoreSourceKey>({
    searchOneSource: (query, page, source) => callMusicApi('searchSongs', query, page, source),
    // 桌面并发 6-7：渐进渲染下慢源稍后并入，首屏不再等最慢源
    concurrency: 6,
  });
  /** 已探测歌曲 id（每搜索会话重置），用于跨源渐进/翻页增量探测去重 */
  private probedIds = new Set<string>();
  /** 探测序号：search/searchAll/reset 时递增，用于丢弃旧搜索在途探测的迟到结果 */
  private probeSeq = 0;

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
      this.probeNewResults(o.results);
    }
    useSearchStore.setState(updates as any);
  }

  /**
   * 对「上一批未探测过的新歌」逐批跑主进程探测（probeSongsBatch，20/批）。
   * 增量去重：渐进/翻页里只探测新增歌曲，不重复探测已探测过的源批次。
   * 失败打开：探测永不阻断搜索渲染。探测序号校验：新搜索/reset 后（probeSeq 递增）
   * 旧搜索在途批次的探测结果直接丢弃，不写入新会话的 audioTag。
   */
  private probeNewResults(groups: SongGroup[]): void {
    const allSongs = groups.flatMap((group) => group.songs);
    if (allSongs.length === 0) return;
    const newSongs = allSongs.filter((s) => !this.probedIds.has(s.id));
    if (newSongs.length === 0) return;
    for (const s of newSongs) this.probedIds.add(s.id);

    const seq = this.probeSeq;
    void (async () => {
      for (let i = 0; i < newSongs.length; i += PROBE_BATCH_SIZE) {
        const batch = newSongs.slice(i, i + PROBE_BATCH_SIZE);
        try {
          const results = await callMusicApi('probeSongsBatch', batch);
          if (seq !== this.probeSeq) return; // 已被新搜索/重置取代，丢弃在途探测结果
          const store = useSearchStore.getState();
          for (const result of results) {
            store.setAudioTag(result.songId, result.tag);
          }
        } catch {
          // 失败打开：探测永不阻断搜索渲染。
        }
      }
    })();
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
    this.probedIds.clear();
    this.probeSeq++;
    return this.orchestrator.search(keyword, route);
  }

  searchAll(keyword: string): void {
    useSearchStore.setState({ sourceType: 'all' } as any);
    this.probedIds.clear();
    this.probeSeq++;
    void this.orchestrator.search(keyword, 'all');
  }

  /**
   * 搜索歌手（仅网易云源有歌手搜索接口）：结果由调用方持有，
   * 搜索结果页的「歌手」tab 用它加载。
   */
  async searchArtists(keyword: string, limit = 30): Promise<Artist[]> {
    return callMusicApi('searchNeteaseArtists', keyword, limit);
  }

  loadMore(): Promise<void> {
    return this.orchestrator.loadMore();
  }

  reset(): void {
    this.probedIds.clear();
    this.probeSeq++;
    this.orchestrator.reset();
  }

  async batchSearch(
    keywords: string[],
    sourceType: ImportSource = 'netease'
  ): Promise<Record<string, Song[]>> {
    try {
      return await callMusicApi('batchSearch', keywords, sourceType);
    } catch (error) {
      console.error('批量搜索失败:', error);
      return {};
    }
  }
}

export const searchService = new SearchService();
