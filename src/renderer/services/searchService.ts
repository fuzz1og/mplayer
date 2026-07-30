import { Song, SongGroup } from '@mplayer/core';
import { useSearchStore } from '@/renderer/store/searchStore';
import { IpcClient } from './IpcClient';


const DEBOUNCE_DELAY = 300;

class SearchService {
  private debounceTimer: NodeJS.Timeout | null = null;
  private searchSeq = 0;

  /**
   * 通用搜索骨架，处理 loading/error/page 逻辑
   */
  private async doSearch<T>(
    keyword: string,
    page: number,
    invoke: () => Promise<T>,
    apply: (result: T, isFirstPage: boolean) => void,
    errorMsg: string,
  ): Promise<void> {
    const store = useSearchStore.getState();

    if (!keyword.trim()) {
      store.reset();
      return;
    }

    store.setLoading(true);
    store.setError(null);

    if (page === 1) {
      store.setCurrentKeyword(keyword);
    }

    try {
      const result = await invoke();
      apply(result, page === 1);
      store.setPage(page);
    } catch (error) {
      store.setError(error instanceof Error ? error.message : errorMsg);
    } finally {
      store.setLoading(false);
    }
  }

  async search(keyword: string, page: number = 1): Promise<void> {
    const store = useSearchStore.getState();
    const sourceType = store.sourceType;

    if (page === 1) {
      store.setSongs([], true);
    }

    await this.doSearch<Song[]>(
      keyword,
      page,
      () => IpcClient.invoke('musicApi:searchSongs', keyword, page, sourceType),
      (songs, isFirstPage) => {
        if (isFirstPage) {
          store.setSongs(songs, true);
        } else {
          store.setSongs(songs, false);
        }
        store.setHasMore(songs.length >= 10);
      },
      '搜索失败',
    );
  }

  async searchAll(keyword: string, page: number = 1): Promise<void> {
    const store = useSearchStore.getState();

    if (page === 1) {
      store.setGroups([], true);
    }

    const seq = ++this.searchSeq;

    await this.doSearch<SongGroup[]>(
      keyword,
      page,
      () => IpcClient.invoke('musicApi:searchAllSources', keyword, page),
      (groups, isFirstPage) => {
        if (isFirstPage) {
          store.setGroups(groups, true);
          store.setHasMore(groups.length > 0);
        } else {
          const prevTotal = store.groups.reduce((sum, g) => sum + g.songs.length, 0);
          store.setGroups(groups, false);
          const newTotal = store.groups.reduce((sum, g) => sum + g.songs.length, 0);
          store.setHasMore(newTotal > prevTotal && groups.length > 0);
        }

        // Fire-and-forget audio probe (non-blocking UI)
        if (seq === this.searchSeq) {
          this.probeResults(groups, seq);
        }
      },
      '全部搜索失败',
    );
  }

  /**
   * Async batch probe of search results — uses core probeAudio, matches mobile's batch pattern.
   * Processes in batches of BATCH_SIZE, updates store after each batch for progressive rendering.
   */
  private probeResults(groups: SongGroup[], seq: number): void {
    const songs = groups.flatMap(g => g.songs);
    const BATCH_SIZE = 5;

    const runBatch = async (startIdx: number) => {
      if (startIdx >= songs.length || seq !== this.searchSeq) return;

      const batch = songs.slice(startIdx, startIdx + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (song) => {
          if (seq !== this.searchSeq) return;
          try {
            // Resolve playable URL first
            const resolvedUrl = await IpcClient.invoke<string>('musicApi:getAudioUrl', song.url);
            const url = resolvedUrl || song.url;
            if (!url) { (song as any).audioTag = 'valid'; return; }

            // Probe using core's probeAudio
            const { probeAudio } = await import('@mplayer/core');
            const tag = await probeAudio({ ...song, url });
            (song as any).audioTag = tag;
          } catch {
            (song as any).audioTag = 'valid';
          }
        })
      );
      if (seq === this.searchSeq) {
        useSearchStore.setState({});
      }
      runBatch(startIdx + BATCH_SIZE);
    };

    runBatch(0);
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
