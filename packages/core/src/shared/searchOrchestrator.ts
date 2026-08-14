import type { Song, SongGroup, SourceKey } from '../types/index.js';
import { MULTI_SOURCE_LIST } from '../constants.js';
import { groupIntoSongGroups } from '../utils/groupIntoSongGroups.js';

/**
 * SearchOrchestrator —— 多源搜索编排深模块（ADR-0003）。
 *
 * 自持状态 + subscribe（~内部 observable，零第三方依赖），接口零 store 形状：
 * 不含 getState/setState 的 Record 桥，两端 store 只做 subscribe 镜像 + source 路由，
 * seq 防 stale / 组内合并 / loadingMore 防御全部单一事实来源地存在于本模块。
 *
 * 语义：
 * - `search(query, route)`：route = 'all' | SourceKey。
 *   - 单源 = 单次调用吐一批（results = [{ key: source, name: source, artist: '', songs }]）。
 *   - 'all' = 按源逐源渐进（concurrency 参数化），每源完成即重组吐结果
 *     （固定源序拼装 → groupIntoSongGroups，与一次性全量分组一致）。
 * - `loadMore()`：在当前 route 上翻页；同源分页去重（跨源同名保留）。
 * - `reset()`：递增 seq 使在途 search/loadMore 失效并清空状态。
 * - `getState()` / `subscribe()`：只读镜像访问（subscribe 返回退订函数）。
 */
export type SearchRoute<S extends string = SourceKey> = 'all' | S;

export interface SearchOrchestratorConfig<S extends string = SourceKey> {
  /** 单源搜索：返回该源的一批 Song[]。 */
  searchOneSource: (query: string, page: number, source: S) => Promise<Song[]>;
  /** 'all' 渐进并发上限（默认 3）。 */
  concurrency?: number;
  /** 'all' 的源序遍历（默认 MULTI_SOURCE_LIST）。 */
  sources?: readonly S[];
}

export interface SearchOrchestratorState {
  results: SongGroup[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  page: number;
  query: string;
  error: string | null;
}

export interface SearchOrchestrator<S extends string = SourceKey> {
  search: (query: string, route: SearchRoute<S>) => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
  getState: () => SearchOrchestratorState;
  subscribe: (listener: (state: SearchOrchestratorState) => void) => () => void;
}

const INITIAL_STATE: SearchOrchestratorState = {
  results: [],
  loading: false,
  loadingMore: false,
  hasMore: true,
  page: 1,
  query: '',
  error: null,
};

/** 同源去重：只与同源已有歌曲比 id 与「name|artist」，跨源同名一律保留。 */
function collectSourceSongs(existing: Song[], adding: Song[]): Song[] {
  const idSet = new Set(existing.map((s) => s.id));
  const nameArtistSet = new Set(existing.map((s) => `${s.name}|${s.artist}`));
  const out: Song[] = [];
  for (const s of adding) {
    const naKey = `${s.name}|${s.artist}`;
    if (idSet.has(s.id) || nameArtistSet.has(naKey)) continue;
    idSet.add(s.id);
    nameArtistSet.add(naKey);
    out.push(s);
  }
  return out;
}

/** ~内部 observable：零第三方依赖的最小 subject。订阅跨 search 持久，由调用方退订。 */
function createEmitter() {
  const listeners = new Set<(state: SearchOrchestratorState) => void>();
  return {
    subscribe(fn: (state: SearchOrchestratorState) => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    emit(state: SearchOrchestratorState): void {
      listeners.forEach((fn) => fn(state));
    },
  };
}

export function createSearchOrchestrator<S extends string = SourceKey>(config: SearchOrchestratorConfig<S>): SearchOrchestrator<S> {
  const { searchOneSource } = config;
  const concurrency = config.concurrency ?? 3;
  const sources: readonly S[] = config.sources ?? (MULTI_SOURCE_LIST as S[]);

  let state: SearchOrchestratorState = { ...INITIAL_STATE };
  let seq = 0;
  let currentRoute: SearchRoute<S> | null = null;
  /** 'all'/'单源' 共用的「按源收集」状态：跨页累积（loadMore 幂等），用于确定式重组。 */
  let collected = new Map<S, Song[]>();
  const emitter = createEmitter();

  function emit(patch: Partial<SearchOrchestratorState>): void {
    state = { ...state, ...patch };
    emitter.emit(state);
  }

  /** 按固定源序重组全部收集歌曲 → 广播 results（保证与一次性全量分组一致）。 */
  function emitResults(): void {
    if (currentRoute === null) return;
    if (currentRoute === 'all') {
      const allSongs = sources.flatMap((s) => collected.get(s) || []);
      emit({ results: groupIntoSongGroups(allSongs) });
    } else {
      const source = currentRoute;
      emit({ results: [{ key: source, name: source, artist: '', songs: collected.get(source) || [] }] });
    }
  }

  /**
   * 将一批新歌曲按源归入 collected，若该页（跨该源的既有分页）去重后有新增
   * 则立即重组广播。返回 true 表示有新增数据。
   */
  function collectAndEmit(source: S, songs: Song[]): boolean {
    if (songs.length === 0) return false;
    const existing = collected.get(source) || [];
    const added = collectSourceSongs(existing, songs);
    if (added.length === 0) return false;
    collected.set(source, [...existing, ...added]);
    emitResults();
    return true;
  }

  /**
   * 'all' 渐进执行：concurrency 个 worker 逐源调用，每源完成立即重组广播。
   * 返回该页是否有任一源返回数据（用于 hasMore）。失败源跳过不影响其他源。
   */
  async function runAllProgressively(query: string, page: number, currentSeq: number): Promise<boolean> {
    let cursor = 0;
    let pageHadData = false;
    const worker = async () => {
      while (cursor < sources.length) {
        const src = sources[cursor++];
        try {
          const songs = await searchOneSource(query, page, src);
          if (seq !== currentSeq) continue; // 已被新查询/clear 取代，丢弃迟到结果
          if (collectAndEmit(src, songs)) pageHadData = true;
        } catch {
          // 单源失败跳过，不影响其他源
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
    return pageHadData;
  }

  async function searchSingle(query: string, page: number, source: S, currentSeq: number): Promise<void> {
    try {
      const songs = await searchOneSource(query, page, source);
      if (seq !== currentSeq) return;
      collectAndEmit(source, songs);
      emit({ page, loading: false, hasMore: songs.length > 0, error: null });
    } catch {
      if (seq !== currentSeq) return;
      emit({ loading: false, error: '搜索失败，请重试' });
    }
  }

  async function searchSingleLoadMore(query: string, page: number, source: S, currentSeq: number): Promise<void> {
    try {
      const songs = await searchOneSource(query, page, source);
      if (seq !== currentSeq || state.query !== query) {
        emit({ loadingMore: false });
        return;
      }
      collectAndEmit(source, songs);
      emit({ page, loadingMore: false, hasMore: songs.length > 0 });
    } catch {
      emit({ loadingMore: false });
    }
  }

  return {
    async search(query, route) {
      const currentSeq = ++seq;
      currentRoute = route;
      collected = new Map();
      emit({ query, results: [], page: 1, loading: true, loadingMore: false, hasMore: true, error: null });

      if (!query.trim()) {
        if (seq !== currentSeq) return;
        emit({ loading: false, hasMore: false });
        return;
      }

      if (route === 'all') {
        const pageHadData = await runAllProgressively(query, 1, currentSeq);
        if (seq !== currentSeq) return;
        emit({ loading: false, hasMore: pageHadData });
      } else {
        await searchSingle(query, 1, route, currentSeq);
      }
    },

    async loadMore() {
      const { query, hasMore, loading, loadingMore } = state;
      if (!query || !hasMore || loading || loadingMore) return;
      if (currentRoute === null) return;

      const currentSeq = seq;
      const currentQuery = query;
      const currentPage = state.page;
      emit({ loadingMore: true, error: null });

      try {
        if (currentRoute === 'all') {
          await runAllProgressively(currentQuery, currentPage + 1, currentSeq);
          if (seq === currentSeq && state.query === currentQuery) {
            emit({ page: currentPage + 1, loadingMore: false });
          } else {
            emit({ loadingMore: false });
          }
        } else {
          await searchSingleLoadMore(currentQuery, currentPage + 1, currentRoute, currentSeq);
        }
      } catch {
        // 失败路径一律清 loadingMore（含过期场景：不能让标志位泄漏卡死无限滚动）
        emit({ loadingMore: false });
      }
    },

    reset() {
      seq++;
      currentRoute = null;
      collected = new Map();
      emit({ ...INITIAL_STATE });
    },

    getState: () => state,
    subscribe: emitter.subscribe,
  };
}
