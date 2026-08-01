import { Song, SongGroup } from '@mplayer/core';
import { useSearchStore } from '@/renderer/store/searchStore';
import { IpcClient } from './IpcClient';
import { ipcMusicApi } from './IpcMusicApi';
import { createSearchController } from '@/shared';

const DEBOUNCE_DELAY = 300;
const PROBE_BATCH_SIZE = 5;

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
          void this.probeResults(groups, seq);
        }
        useSearchStore.setState(updates as any);
      },
    });
  }

  /**
   * Probe every song in progressive batches, matching the mobile search flow.
   */
  private async probeResults(groups: SongGroup[], seq: number): Promise<void> {

    try {
      const allSongs = groups.flatMap(group => group.songs);
      if (allSongs.length === 0) return;
      const { probeAudio } = await import('@mplayer/core');

      for (let i = 0; i < allSongs.length; i += PROBE_BATCH_SIZE) {
        if (seq !== this.searchSeq) return;
        const batch = allSongs.slice(i, i + PROBE_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (song) => {
            try {
              const resolvedUrl = await IpcClient.invoke<string>('musicApi:getAudioUrl', song.url);
              const url = resolvedUrl || song.url;
              const tag = url ? await probeAudio({ ...song, url }) : 'valid';
              return { songId: song.id, tag };
            } catch {
              return { songId: song.id, tag: 'valid' as const };
            }
          })
        );
        if (seq !== this.searchSeq) return;
        const store = useSearchStore.getState();
        for (const result of results) {
          if (result.status === 'fulfilled') {
            store.setAudioTag(result.value.songId, result.value.tag);
          }
        }
      }
    } catch {
      // Fail open: probing must never break search rendering.
    }
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
