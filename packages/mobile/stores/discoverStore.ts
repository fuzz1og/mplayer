import { create } from 'zustand';
import { getToplistSongs, TOPLIST_SOURCE_IDS } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';

/** 发现页内容 tab（与顶部 TextTabs 一一对应）。 */
export type DiscoverTab = 'hotlist' | 'albums' | 'playlists' | 'artists';

/** 榜单来源：目前只有网易云 / QQ 实现了热歌榜与新歌榜。 */
export type DiscoverSource = 'netease' | 'qq';

export const DISCOVER_TABS: { key: DiscoverTab; label: string }[] = [
  { key: 'hotlist', label: '排行榜' },
  { key: 'albums', label: '新碟' },
  { key: 'playlists', label: '歌单' },
  { key: 'artists', label: '歌手' },
];

/**
 * 来源选项只出现在排行榜 tab（新碟/歌单/歌手数据面目前只有网易云直连），
 * 避免在其余 tab 显示 QQ 造成误导。
 */
export const DISCOVER_SOURCES: { key: DiscoverSource; label: string }[] = [
  { key: 'netease', label: '网易云' },
  { key: 'qq', label: 'QQ' },
];

/** 榜单缓存有效期：同一来源在 TTL 内再次进入 tab 不重复请求。 */
export const DISCOVER_CACHE_TTL_MS = 10 * 60 * 1000;

/** 每个榜单 section 展示的行数（热歌榜 / 新歌榜各 10 行）。 */
export const DISCOVER_CHART_ROWS = 10;

/** 发现页榜单条目视图（rank 由索引推导，#239）。 */
export interface HotlistItem {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
  /** 时长（秒）；0 = 源未提供，UI 显示占位。 */
  duration: number;
}

/** 单个来源的榜单数据（热歌 + 新歌），loadedAt 供缓存 TTL 使用。 */
export interface DiscoverChartData {
  hotlist: HotlistItem[];
  newSongs: HotlistItem[];
  loadedAt: number | null;
}

/** Song → 榜单视图条目（榜单各源统一经能力面 getToplists 返回 Song）。 */
function toHotlistItems(songs: Song[]): HotlistItem[] {
  return songs.map((s, i) => ({
    id: s.id,
    name: s.name,
    artists: s.artist,
    rank: i + 1,
    cover: s.cover,
    album: s.album,
    duration: s.duration,
  }));
}

/** 榜单条目 → 播放用 Song（榜单数据不含 url/lrc，播放前由 searchStrictMatch 回填）。 */
export function hotlistItemToSong(item: HotlistItem, sourceType: SourceKey): Song {
  return {
    id: item.id,
    name: item.name,
    artist: item.artists,
    album: item.album,
    cover: item.cover,
    url: '',
    lrc: '',
    duration: item.duration,
    sourceType,
  };
}

/**
 * 榜单点歌的入队语义（用户可观察行为，单测直接覆盖）：
 * 当前 section 的整组歌曲进队列，只把选中位置替换成搜索命中的 url/lrc——
 * 不退化成单曲队列，也不播搜索结果本体（防同名 cover 错播）。
 */
export function buildHotlistQueue(
  items: HotlistItem[],
  index: number,
  sourceType: SourceKey,
  resolved?: Song | null,
): { queue: Song[]; song: Song | null; index: number } {
  const queue = items.map((item) => hotlistItemToSong(item, sourceType));
  if (queue.length === 0) return { queue, song: null, index: 0 };
  const safeIndex = Math.max(0, Math.min(index, queue.length - 1));
  if (resolved) {
    const base = queue[safeIndex]!;
    queue[safeIndex] = { ...base, url: resolved.url || '', lrc: resolved.lrc || '' };
  }
  return { queue, song: queue[safeIndex]!, index: safeIndex };
}

interface DiscoverState {
  tab: DiscoverTab;
  source: DiscoverSource;
  /** 按来源缓存的榜单数据：来源切换不互相覆盖。 */
  charts: Record<DiscoverSource, DiscoverChartData>;
  /** 当前来源的首次加载态（网格 tab 各自管理自己的加载态）。 */
  loading: boolean;
  /** 当前来源的加载失败文案；失败不再被吞掉，UI 给重试入口。 */
  error: string | null;

  setTab: (tab: DiscoverTab) => void;
  setSource: (source: DiscoverSource) => void;
  /** 加载当前来源榜单；fresh 缓存直接命中，不重复请求。 */
  load: (options?: { force?: boolean }) => Promise<void>;
  /** 失败重试：强制绕过缓存重新加载当前来源。 */
  retry: () => Promise<void>;
}

function emptyChart(): DiscoverChartData {
  return { hotlist: [], newSongs: [], loadedAt: null };
}

/**
 * 最近一次请求序号：来源快速切换时，旧响应不得覆盖新来源的 loading/error 归属。
 * 数据仍按请求发起时的来源写入各自缓存。
 */
let loadSeq = 0;
const inFlightSources = new Set<DiscoverSource>();

export const useDiscoverStore = create<DiscoverState>((set, get) => ({
  tab: 'hotlist',
  source: 'netease',
  charts: { netease: emptyChart(), qq: emptyChart() },
  loading: false,
  error: null,

  setTab: (tab) => set({ tab }),

  setSource: (source) => {
    if (source === get().source) return;
    // 来源切换本身不请求：当前 tab 若是排行榜，由其 effect 调 load()；
    // 其余三个 tab 没有 QQ 数据面，不应被来源切换触发额外请求。
    set({ source, error: null });
  },

  load: async (options = {}) => {
    const source = get().source;
    const cached = get().charts[source];
    const fresh = cached.loadedAt !== null && Date.now() - cached.loadedAt < DISCOVER_CACHE_TTL_MS;
    if (!options.force && (fresh || inFlightSources.has(source))) return;

    const seq = ++loadSeq;
    inFlightSources.add(source);
    set({ loading: true, error: null });

    try {
      const ids = TOPLIST_SOURCE_IDS[source];
      const [hotSongs, newSongs] = await Promise.all([
        getToplistSongs(source, ids.hot),
        getToplistSongs(source, ids.new),
      ]);
      set((state) => {
        const next: Partial<DiscoverState> = {
          charts: {
            ...state.charts,
            [source]: {
              hotlist: toHotlistItems(hotSongs).slice(0, DISCOVER_CHART_ROWS),
              newSongs: toHotlistItems(newSongs).slice(0, DISCOVER_CHART_ROWS),
              loadedAt: Date.now(),
            },
          },
        };
        if (seq === loadSeq) {
          next.loading = false;
          next.error = null;
        }
        return next;
      });
    } catch (err) {
      console.error('加载发现页榜单失败:', err);
      // 只有最新一次请求有资格更新当前来源的错误提示；旧来源失败只留在日志里。
      if (seq === loadSeq && get().source === source) {
        set({ loading: false, error: '榜单加载失败，请检查网络后重试' });
      } else if (seq === loadSeq) {
        set({ loading: false });
      }
    } finally {
      inFlightSources.delete(source);
    }
  },

  retry: async () => {
    await get().load({ force: true });
  },
}));
