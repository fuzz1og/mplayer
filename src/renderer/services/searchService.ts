import { Song, SongGroup } from '@/shared/types/song';
import { useSearchStore } from '@/renderer/store/searchStore';
import { IpcClient } from './IpcClient';

const DEBOUNCE_DELAY = 300;

class SearchService {
  private debounceTimer: NodeJS.Timeout | null = null;

  async search(keyword: string, page: number = 1): Promise<void> {
    const store = useSearchStore.getState();

    if (!keyword.trim()) {
      store.reset();
      return;
    }

    store.setLoading(true);
    store.setError(null);

    if (page === 1) {
      store.setSongs([], true);
      store.setCurrentKeyword(keyword);
    }

    try {
      const songs = await IpcClient.invoke<Song[]>('musicApi:searchSongs', keyword, page, store.sourceType);

      if (page === 1) {
        store.setSongs(songs, true);
        store.setPage(page);
        store.setHasMore(songs.length >= 10);
      } else {
        if (songs.length > 0) {
          store.setSongs(songs, false);
          store.setPage(page);
        }
        store.setHasMore(songs.length >= 10);
      }
    } catch (error) {
      store.setError(error instanceof Error ? error.message : '搜索失败');
    } finally {
      store.setLoading(false);
    }
  }

  async searchAll(keyword: string, page: number = 1): Promise<void> {
    const store = useSearchStore.getState();

    if (!keyword.trim()) {
      store.reset();
      return;
    }

    store.setLoading(true);
    store.setError(null);

    if (page === 1) {
      store.setGroups([], true);
      store.setCurrentKeyword(keyword);
    }

    try {
      const groups = await IpcClient.invoke<SongGroup[]>('musicApi:searchAllSources', keyword, page);

      if (page === 1) {
        store.setGroups(groups, true);
        store.setPage(page);
        store.setHasMore(groups.length > 0);
      } else {
        // 加载更多：检查是否有实际新增内容
        const prevGroups = store.groups;
        const prevTotalSongs = prevGroups.reduce((sum, g) => sum + g.songs.length, 0);
        store.setGroups(groups, false);
        const newTotalSongs = store.groups.reduce((sum, g) => sum + g.songs.length, 0);
        const hasNewContent = newTotalSongs > prevTotalSongs;
        store.setPage(page);
        store.setHasMore(hasNewContent);
      }
    } catch (error) {
      store.setError(error instanceof Error ? error.message : '全部搜索失败');
    } finally {
      store.setLoading(false);
    }
  }

  debouncedSearch(keyword: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.search(keyword);
    }, DEBOUNCE_DELAY);
  }

  async loadMore(): Promise<void> {
    const store = useSearchStore.getState();
    const { currentKeyword, page, hasMore, loading, sourceType } = store;

    if (!currentKeyword || !hasMore || loading) {
      return;
    }

    if (sourceType === 'all') {
      await this.searchAll(currentKeyword, page + 1);
    } else {
      await this.search(currentKeyword, page + 1);
    }
  }

  reset(): void {
    useSearchStore.getState().reset();
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
