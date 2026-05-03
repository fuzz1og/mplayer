import { musicApi } from '@/main/api/musicApi';
import { useSearchStore } from '@/renderer/store/searchStore';
import { dedupeSongs } from '@/renderer/utils/songDedupe';

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

    try {
      const songs = await musicApi.searchSongs(keyword, page, store.sourceType);

      if (page === 1) {
        store.setSongs(songs, true);
        store.setCurrentKeyword(keyword);
        store.setPage(page);
        store.setHasMore(songs.length === 10);
      } else {
        const currentSongs = store.songs;
        const uniqueSongs = dedupeSongs(currentSongs, songs);

        if (uniqueSongs.length > 0) {
          store.setSongs(songs, false);
          store.setPage(page);
        }

        store.setHasMore(songs.length === 10);
      }
    } catch (error) {
      store.setError(error instanceof Error ? error.message : '搜索失败');
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
    const { currentKeyword, page, hasMore, loading } = store;

    if (!currentKeyword || !hasMore || loading) {
      return;
    }

    await this.search(currentKeyword, page + 1);
  }

  reset(): void {
    useSearchStore.getState().reset();
  }
}

export const searchService = new SearchService();
