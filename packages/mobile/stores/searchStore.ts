import { create } from 'zustand';
import { musicApi } from '@mplayer/core';
import type { SongGroup, SourceKey } from '@mplayer/core';
import type { SourceOption } from './sourceStore';
import { probeAudio } from '../services/audioProbe';
import { createSearchController } from '@mplayer/core';

const SOURCE_LABELS: Record<SourceOption, string> = {
  all: '全部',
  netease: '网易云',
  qq: 'QQ音乐',
  kugou: '酷狗',
  migu: '咪咕',
  kuwo: '酷我',
  qianqian: '千千',
  soda: '汽水',
  local: '本地',
};

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

export const useSearchStore = create<SearchState>((set, get) => {
  const searchFn = async (query: string, page: number, source: string): Promise<SongGroup[]> => {
    if (source === 'all') {
      return musicApi.searchAllSources(query, page);
    }
    const songs = await musicApi.searchSongs(query, page, source as SourceKey);
    return [{ key: source, name: SOURCE_LABELS[source as SourceOption], artist: '', songs }];
  };

  const controller = createSearchController({
    searchFn,
    getState: get,
    setState: set,
  });

  return {
    query: '',
    results: [],
    loading: false,
    error: null,
    page: 1,
    hasMore: true,
    loadingMore: false,

    search: async (query: string) => {
      await controller.search(query);
      // 非阻塞探测
      const state = get();
      if (state.results.length > 0) {
        probeResults(state.results);
      }
    },
    loadMore: () => controller.loadMore(),
    clear: () => controller.reset(),
  };
});

async function probeResults(groups: SongGroup[]) {
  const allSongs = groups.flatMap(g => g.songs);
  const BATCH_SIZE = 5;
  for (let i = 0; i < allSongs.length; i += BATCH_SIZE) {
    const batch = allSongs.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (song) => {
        const tag = await probeAudio(song);
        (song as any).audioTag = tag;
      })
    );
    useSearchStore.setState({});
  }
}