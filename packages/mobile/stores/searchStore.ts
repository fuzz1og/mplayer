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
      const source = useSourceStore.getState().selectedSource;
      if (source === 'all') {
        // 同名歌曲组内增量：每源完成即渲染(组内并入该源版本)，不等最慢源；
        // 探测在全部完成后统一跑(与搜索并发会抢手机网络带宽)
        await progressiveSearch(query, 1);
        const state = get();
        if (state.results.length > 0) {
          probeResults(state.results);
        }
        return;
      }
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
    loadMore: async () => {
      const s = get();
      if (s.loading || s.loadingMore || !s.hasMore) return;
      const source = useSourceStore.getState().selectedSource;
      if (source === 'all') {
        // 分页走全量 searchAllSources（慢源等待可接受，用户已在浏览），
        // 但按组 key 合并：渐进首屏的组 + 第二页组不能出现同名组重复
        set({ loadingMore: true });
        const page = s.page + 1;
        try {
          const groups = await musicApi.searchAllSources(s.query, page);
          set({ results: mergeGroupedResults(s.results, groups), page, loadingMore: false });
        } catch {
          set({ loadingMore: false });
        }
        return;
      }
      await controller.loadMore();
    },
    clear: () => controller.reset(),
  };
});

/** 按组 key 合并两组结果（同名歌曲组内追加，不产生重复组） */
function mergeGroupedResults(prev: SongGroup[], incoming: SongGroup[]): SongGroup[] {
  const map = new Map<string, SongGroup>(prev.map((g) => [g.key, { ...g, songs: [...g.songs] }]));
  for (const g of incoming) {
    const ex = map.get(g.key);
    if (ex) ex.songs.push(...g.songs);
    else map.set(g.key, { ...g, songs: [...g.songs] });
  }
  return Array.from(map.values());
}

/**
 * 多源渐进搜索（同名歌曲组内增量）：
 * 各源并行，每源完成立即重跑 groupIntoSongGroups（确定性纯函数，
 * 与一次性全量结果一致）——先到的源先组成同名组渲染，慢源(如 kugou 4.5s)
 * 完成后其版本并入已有同名组（组内+1 首）。
 * 关键：按源收集、渲染时按固定源序拼装，保证组内顺序不受完成顺序影响。
 * 探测不在这里跑——与搜索并发会抢手机网络带宽（实测搜索 4.8s→8s），
 * 由 search() 在全部完成后统一触发。
 */
async function progressiveSearch(query: string, page: number): Promise<void> {
  const sources: SourceKey[] = ['netease', 'qq', 'kugou', 'kuwo', 'qianqian', 'soda'];
  const t0 = Date.now();
  useSearchStore.setState({ loading: true, error: null, query, page, results: [], hasMore: true, loadingMore: false });
  const collected = new Map<SourceKey, SongGroup['songs']>();
  await Promise.all(
    sources.map(async (src) => {
      try {
        const songs = await musicApi.searchSongs(query, page, src);
        if (songs.length === 0) return;
        collected.set(src, songs);
        // 按固定源序拼装 → 重跑分组（组内/组顺序与一次性全量完全一致）
        const allSongs = sources.flatMap((s) => collected.get(s) || []);
        useSearchStore.setState({ results: musicApi.groupIntoSongGroups(allSongs) });
      } catch {
        // 单源失败跳过，不影响其他源
      }
    })
  );
  useSearchStore.setState({ loading: false });
  useLogsStore.getState().addLog('info', `搜索完成: 词「${query}」耗时 ${Date.now() - t0}ms`);
}

async function probeResults(groups: SongGroup[]) {
  const allSongs = groups.flatMap(g => g.songs);
  const t0 = Date.now();
  // 手机网络慢,提高并发减少批数(每批 = 最慢一首的耗时)
  const BATCH_SIZE = 20;
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