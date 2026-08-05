import type { Song, SongGroup, AudioTag, ImportSource, Artist } from '@mplayer/core';
import { useSearchStore } from '@/renderer/store/searchStore';
import { IpcClient } from './IpcClient';
import { ipcMusicApi } from './IpcMusicApi';
import { createSearchController } from '@/shared';

const DEBOUNCE_DELAY = 300;
const PROBE_BATCH_SIZE = 20;

interface ProbeResult {
  songId: string;
  tag: AudioTag;
}

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
   * Probe in main-process batches so audio URLs are resolved and HEAD-checked
   * without renderer CORS limits, then update rows as each batch finishes.
   */
  private async probeResults(groups: SongGroup[], seq: number): Promise<void> {
    const allSongs = groups.flatMap(group => group.songs);
    if (allSongs.length === 0) return;

    for (let i = 0; i < allSongs.length; i += PROBE_BATCH_SIZE) {
      if (seq !== this.searchSeq) return;
      const batch = allSongs.slice(i, i + PROBE_BATCH_SIZE);

      try {
        const results = await IpcClient.invoke<ProbeResult[]>('musicApi:probeAudio', batch);
        if (seq !== this.searchSeq) return;
        const store = useSearchStore.getState();
        for (const result of results) {
          store.setAudioTag(result.songId, result.tag);
        }
      } catch {
        // Fail open: probing must never break search rendering.
      }
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

  /**
   * 搜索歌手（仅网易云源有歌手搜索接口）：结果由调用方持有，
   * 搜索结果页的「歌手」tab 用它加载。
   */
  async searchArtists(keyword: string, limit = 30): Promise<Artist[]> {
    return ipcMusicApi.searchArtists(keyword, limit);
  }

  loadMore(): Promise<void> {
    return this.controller.loadMore();
  }

  reset(): void {
    this.controller.reset();
  }

  async batchSearch(
    keywords: string[],
    sourceType: ImportSource = 'netease'
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
