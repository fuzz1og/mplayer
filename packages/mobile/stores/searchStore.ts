import { create } from 'zustand';
import { musicApi, createSearchController, MULTI_SOURCE_LIST } from '@mplayer/core';
import type { SongGroup, SourceKey } from '@mplayer/core';
import { useSourceStore, SOURCE_OPTION_LABELS } from './sourceStore';
import { useLogsStore } from './logsStore';
import { probeSongsWithTags } from '../services/songProbe';

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
    return [{ key: source, name: SOURCE_OPTION_LABELS[source as SourceKey], artist: '', songs }];
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
      // 新查询递增序号：上一查询的迟到源结果（如 kugou 慢 8s）不得覆盖本次结果
      const seq = ++searchSeq;
      if (source === 'all') {
        // 同名歌曲组内增量：每源完成即渲染(组内并入该源版本)，不等最慢源；
        // 探测在全部完成后统一跑(与搜索并发会抢手机网络带宽)
        await progressiveSearch(query, 1, seq);
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
        const seq = searchSeq;
        try {
          const groups = await musicApi.searchAllSources(s.query, page);
          if (seq !== searchSeq) { set({ loadingMore: false }); return; } // 已发新查询，丢弃过期结果
          set({ results: mergeGroupedResults(s.results, groups), page, loadingMore: false });
        } catch {
          set({ loadingMore: false });
        }
        return;
      }
      await controller.loadMore();
    },
    clear: () => {
      searchSeq++;
      controller.reset();
    },
  };
});

/** 全局搜索序号：新查询/clear 递增，用于丢弃过期源的迟到结果 */
let searchSeq = 0;

/** 按组 key 合并两组结果（同名歌曲组内追加且去重，不产生重复组） */
function mergeGroupedResults(prev: SongGroup[], incoming: SongGroup[]): SongGroup[] {
  const map = new Map<string, SongGroup>(prev.map((g) => [g.key, { ...g, songs: [...g.songs] }]));
  for (const g of incoming) {
    const ex = map.get(g.key);
    if (ex) {
      // 组内是同一首歌的各源版本，跨源同名必须保留（不同音频）；
      // 仅同源同名视为重复（分页接口可能跨页返回同源重复歌）
      const seen = new Set(ex.songs.map((s) => `${s.sourceType}|${s.name}|${s.artist}`));
      ex.songs.push(...g.songs.filter((s) => !seen.has(`${s.sourceType}|${s.name}|${s.artist}`)));
    } else {
      map.set(g.key, { ...g, songs: [...g.songs] });
    }
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
async function progressiveSearch(query: string, page: number, seq: number): Promise<void> {
  const sources: SourceKey[] = MULTI_SOURCE_LIST;
  const t0 = Date.now();
  useSearchStore.setState({ loading: true, error: null, query, page, results: [], hasMore: true, loadingMore: false });
  const collected = new Map<SourceKey, SongGroup['songs']>();
  await Promise.all(
    sources.map(async (src) => {
      try {
        const songs = await musicApi.searchSongs(query, page, src);
        if (seq !== searchSeq) return; // 已被新查询/clear 取代，丢弃迟到结果
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
  if (seq !== searchSeq) return;
  useSearchStore.setState({ loading: false });
  useLogsStore.getState().addLog('info', `搜索完成: 词「${query}」耗时 ${Date.now() - t0}ms`);
}

async function probeResults(groups: SongGroup[]) {
  // 统一走 songProbe 管道（专辑/歌单/歌手/发现榜单共用同一实现）
  await probeSongsWithTags(groups.flatMap((g) => g.songs));
}