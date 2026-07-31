import { Song, SongGroup } from '@mplayer/core';
import { useSearchStore } from '@/renderer/store/searchStore';
import { IpcClient } from './IpcClient';
import { ipcMusicApi } from './IpcMusicApi';
import { createSearchController } from '@/shared';

const DEBOUNCE_DELAY = 300;

class SearchService {
  private debounceTimer: NodeJS.Timeout | null = null;
  private searchSeq = 0;
  private controller;

  constructor() {
    this.controller = createSearchController({
      searchFn: async (query, page, source) => {
        if (source === 'all') {
          return ipcMusicApi.searchAllSources(query, page);
        }
        const songs = await ipcMusicApi.searchSongs(query, page, source as any);
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
          const groups = partial.results as SongGroup[];
          const seq = ++this.searchSeq;
          if (store.sourceType === 'all') {
            updates.groups = groups;
          } else {
            updates.songs = groups.flatMap(g => g.songs);
          }
          this.probeResults(groups, seq);
        }
        useSearchStore.setState(updates as any);
      },
    });
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
            if (!url) { useSearchStore.getState().setAudioTag(song.id, 'valid'); return; }

            // Probe using core's probeAudio
            const { probeAudio } = await import('@mplayer/core');
            const tag = await probeAudio({ ...song, url });
            if (seq === this.searchSeq) useSearchStore.getState().setAudioTag(song.id, tag);
          } catch {
            if (seq === this.searchSeq) useSearchStore.getState().setAudioTag(song.id, 'valid');
          }
        })
      );
      if (seq === this.searchSeq) {
        runBatch(startIdx + BATCH_SIZE);
      }
    };

    runBatch(0);
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
