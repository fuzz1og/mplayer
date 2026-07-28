import { Song, SongGroup } from '@mplayer/core';
import { useSearchStore } from '@/renderer/store/searchStore';
import { IpcClient } from './IpcClient';
import { createSearchController } from '@/shared';

const DEBOUNCE_DELAY = 300;

class SearchService {
  private debounceTimer: NodeJS.Timeout | null = null;
  private controller;

  constructor() {
    this.controller = createSearchController({
      searchFn: async (query, page, source) => {
        if (source === 'all') {
          return IpcClient.invoke<SongGroup[]>('musicApi:searchAllSources', query, page);
        }
        const songs = await IpcClient.invoke<Song[]>('musicApi:searchSongs', query, page, source);
        return [{ key: source, name: source, artist: '', songs }];
      },
      getState: () => {
        const s = useSearchStore.getState();
        return {
          query: s.currentKeyword,
          source: s.sourceType,
          page: s.page,
          hasMore: s.hasMore,
          loading: s.loading,
          results: s.sourceType === 'all' ? s.groups : s.songs.map((song: Song) => ({ key: s.sourceType, name: s.sourceType, artist: '', songs: [song] })),
        };
      },
      setState: (partial) => {
        const store = useSearchStore.getState();
        const updates: Record<string, any> = {};
        if ('loading' in partial) updates.loading = partial.loading;
        if ('error' in partial) updates.error = partial.error;
        if ('hasMore' in partial) updates.hasMore = partial.hasMore;
        if ('page' in partial) updates.page = partial.page;
        if ('query' in partial) updates.currentKeyword = partial.query;
        if ('results' in partial) {
          if (store.sourceType === 'all') {
            updates.groups = partial.results as SongGroup[];
          } else {
            updates.songs = (partial.results as SongGroup[]).flatMap(g => g.songs);
          }
        }
        useSearchStore.setState(updates as any);
      },
    });
  }

  debouncedSearch(keyword: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.search(keyword);
    }, DEBOUNCE_DELAY);
  }

  search(keyword: string): Promise<void> {
    return this.controller.search(keyword);
  }

  searchAll(keyword: string): void {
    useSearchStore.setState({ sourceType: 'all' } as any);
    this.controller.search(keyword);
  }

  loadMore(): Promise<void> {
    return this.controller.loadMore();
  }

  reset(): void {
    this.controller.reset();
  }

  async batchSearch(
    keywords: string[],
    sourceType: 'netease' | 'qq' | 'kugou' | 'migu' | 'kuwo' | 'qianqian' | 'soda' = 'netease'
  ): Promise<Record<string, Song[]>> {
    try {
      return await IpcClient.invoke<Record<string, Song[]>>('musicApi:batchSearch', keywords, sourceType);
    } catch (error) {
      console.error('批量搜索失败:', error);
      return {};
    }
  }
}

export const searchService = new SearchService();