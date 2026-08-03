import { create } from 'zustand';
import { musicApi } from '@mplayer/core';
import type { SongGroup, SourceKey } from '@mplayer/core';
import type { SourceOption } from './sourceStore';
import { useSourceStore } from './sourceStore';
import { useLogsStore } from './logsStore';
import { useAudioTagStore } from './audioTagStore';
import { probeAudio } from '../services/audioProbe';
import { createSearchController } from '@mplayer/core';

const SOURCE_LABELS: Record<SourceOption, string> = {
  all: '全部',
  netease: '网易云',
  qq: 'QQ音乐',
  kugou: '酷狗',
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
    // controller 通过 getState().source 读取当前源;
    // SearchStore state 没有 source 字段,这里实时合并 sourceStore 的值
    getState: () => ({ ...get(), source: useSourceStore.getState().selectedSource }),
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
      const t0 = Date.now();
      await controller.search(query);
      const searchMs = Date.now() - t0;
      useLogsStore.getState().addLog('info', `搜索完成: 词「${query}」耗时 ${searchMs}ms`);
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
  const t0 = Date.now();
  const BATCH_SIZE = 10;
  let valid = 0;
  let preview = 0;
  let invalid = 0;
  const { setTag } = useAudioTagStore.getState();
  for (let i = 0; i < allSongs.length; i += BATCH_SIZE) {
    const batch = allSongs.slice(i, i + BATCH_SIZE);
    // 每批完成立即 setTag → SongRow 按 id 订阅,只重渲染标签变化的行,
    // 标签渐进式出现,不用等全部探测完
    await Promise.allSettled(
      batch.map(async (song) => {
        const tag = await probeAudio(song);
        if (tag === 'preview') preview++;
        else if (tag === 'invalid') invalid++;
        else valid++;
        setTag(song, tag);
      })
    );
  }
  useLogsStore.getState().addLog('info', `探测完成: 共${allSongs.length}首, 完整${valid} 片段${preview} 无效${invalid}, 耗时 ${Date.now() - t0}ms`);
}