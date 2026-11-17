import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOPLIST_SOURCE_IDS } from '@mplayer/core';
import type { Song } from '@mplayer/core';

const mocks = vi.hoisted(() => ({
  getToplistSongs: vi.fn(),
}));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  return { ...actual, getToplistSongs: mocks.getToplistSongs };
});

import {
  DISCOVER_CHART_ROWS,
  DISCOVER_SOURCES,
  DISCOVER_TABS,
  buildHotlistQueue,
  hotlistItemToSong,
  useDiscoverStore,
} from '../stores/discoverStore';
import type { HotlistItem } from '../stores/discoverStore';
import { useSourceStore } from '../stores/sourceStore';

function song(id: string, name: string, source: 'netease' | 'qq' = 'netease', duration = 225): Song {
  return {
    id,
    name,
    artist: '测试歌手',
    album: '测试专辑',
    cover: 'https://cover.example/a.jpg',
    url: '',
    lrc: '',
    duration,
    sourceType: source,
  };
}

function resetStore() {
  useDiscoverStore.setState({
    tab: 'hotlist',
    source: 'netease',
    charts: {
      netease: { hotlist: [], newSongs: [], loadedAt: null },
      qq: { hotlist: [], newSongs: [], loadedAt: null },
    },
    loading: false,
    error: null,
  });
}

function hotItem(index: number): HotlistItem {
  return {
    id: `item-${index}`,
    name: `歌曲 ${index}`,
    artists: '测试歌手',
    rank: index + 1,
    cover: 'https://cover.example/a.jpg',
    album: '测试专辑',
    duration: 180 + index,
  };
}

beforeEach(() => {
  mocks.getToplistSongs.mockReset();
  resetStore();
  useSourceStore.getState().setSelectedSource('all');
});

describe('discoverStore 排行榜数据面', () => {
  it('默认只请求当前来源（网易云）的热歌/新歌，映射时长并截断到 10 行', async () => {
    const hotSongs = Array.from({ length: 12 }, (_, i) => song(`nh${i}`, `网易热歌 ${i}`, 'netease', 200 + i));
    mocks.getToplistSongs.mockImplementation(async (source: string, id: number) => {
      if (source === 'netease' && id === TOPLIST_SOURCE_IDS.netease.hot) return hotSongs;
      if (source === 'netease' && id === TOPLIST_SOURCE_IDS.netease.new) return [song('nn1', '网易新歌', 'netease', 0)];
      return [];
    });

    await useDiscoverStore.getState().load();

    expect(mocks.getToplistSongs).toHaveBeenCalledTimes(2);
    for (const [source] of mocks.getToplistSongs.mock.calls) {
      expect(source).toBe('netease');
    }

    const state = useDiscoverStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.charts.netease.hotlist).toHaveLength(DISCOVER_CHART_ROWS);
    expect(state.charts.netease.hotlist[0]?.duration).toBe(200);
    expect(state.charts.netease.newSongs[0]?.duration).toBe(0);
    // 其他来源缓存不受影响
    expect(state.charts.qq.hotlist).toEqual([]);
  });

  it('加载失败不吞错：写入可展示的 error，retry 强制重试后清空', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getToplistSongs.mockRejectedValue(new Error('offline'));

    await useDiscoverStore.getState().load();

    expect(useDiscoverStore.getState().loading).toBe(false);
    expect(useDiscoverStore.getState().error).toBe('榜单加载失败，请检查网络后重试');

    mocks.getToplistSongs.mockImplementation(async (source: string, id: number) => {
      if (source === 'netease' && id === TOPLIST_SOURCE_IDS.netease.hot) return [song('nh1', '热歌')];
      return [song('nn1', '新歌')];
    });
    await useDiscoverStore.getState().retry();

    const state = useDiscoverStore.getState();
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.charts.netease.hotlist).toHaveLength(1);
    expect(mocks.getToplistSongs).toHaveBeenCalledTimes(4);
    errorSpy.mockRestore();
  });

  it('切换来源只改发现页状态并只请求新来源；TTL 内重复 load 命中缓存', async () => {
    mocks.getToplistSongs.mockImplementation(async (source: string, id: number) => {
      if (source === 'netease' && id === TOPLIST_SOURCE_IDS.netease.hot) return [song('nh1', '网易热歌')];
      if (source === 'netease' && id === TOPLIST_SOURCE_IDS.netease.new) return [song('nn1', '网易新歌')];
      if (source === 'qq' && id === TOPLIST_SOURCE_IDS.qq.hot) return [song('qh1', 'QQ 热歌', 'qq')];
      return [song('qn1', 'QQ 新歌', 'qq')];
    });

    await useDiscoverStore.getState().load();
    expect(mocks.getToplistSongs).toHaveBeenCalledTimes(2);

    // 来源切换本身不请求（由当前 tab 的 effect 决定何时 load）
    useDiscoverStore.getState().setSource('qq');
    expect(useDiscoverStore.getState().source).toBe('qq');
    expect(mocks.getToplistSongs).toHaveBeenCalledTimes(2);

    await useDiscoverStore.getState().load();
    expect(mocks.getToplistSongs).toHaveBeenCalledTimes(4);
    for (const [source] of mocks.getToplistSongs.mock.calls.slice(2)) {
      expect(source).toBe('qq');
    }
    expect(useDiscoverStore.getState().charts.qq.hotlist[0]?.name).toBe('QQ 热歌');

    // TTL 内回到已有缓存：不再发请求
    await useDiscoverStore.getState().load();
    expect(mocks.getToplistSongs).toHaveBeenCalledTimes(4);

    useDiscoverStore.getState().setSource('netease');
    await useDiscoverStore.getState().load();
    expect(mocks.getToplistSongs).toHaveBeenCalledTimes(4);
    expect(useDiscoverStore.getState().charts.netease.hotlist[0]?.name).toBe('网易热歌');

    // 发现页来源不污染全局搜索来源（用户故事 3）
    expect(useSourceStore.getState().selectedSource).toBe('all');
  });

  it('tab 切换是用户可观察状态，四个 tab 具备固定键面', () => {
    expect(DISCOVER_TABS.map((t) => t.key)).toEqual(['hotlist', 'albums', 'playlists', 'artists']);
    useDiscoverStore.getState().setTab('albums');
    expect(useDiscoverStore.getState().tab).toBe('albums');
    useDiscoverStore.getState().setTab('artists');
    expect(useDiscoverStore.getState().tab).toBe('artists');
  });

  it('来源选项只有网易云与 QQ（其余 tab 不暴露 QQ 数据面）', () => {
    expect(DISCOVER_SOURCES.map((s) => s.key)).toEqual(['netease', 'qq']);
  });
});

describe('榜单点歌队列语义', () => {
  it('当前 section 整组入队，只把选中位置替换为搜索命中的 url/lrc', () => {
    const items = Array.from({ length: 10 }, (_, i) => hotItem(i));
    const resolved: Song = { ...song('item-3', '歌曲 3'), url: 'https://audio.example/3.mp3', lrc: '[00:00]歌词' };

    const result = buildHotlistQueue(items, 3, 'netease', resolved);

    // 不退化成单曲队列
    expect(result.queue).toHaveLength(10);
    expect(result.index).toBe(3);
    expect(result.queue.map((s) => s.id)).toEqual(items.map((i) => i.id));
    // 原条目身份保留，只回填可播放地址与歌词
    expect(result.song?.id).toBe('item-3');
    expect(result.song?.name).toBe('歌曲 3');
    expect(result.song?.url).toBe('https://audio.example/3.mp3');
    expect(result.song?.lrc).toBe('[00:00]歌词');
    expect(result.queue[0]?.duration).toBe(180);
    expect(result.queue[9]?.duration).toBe(189);
  });

  it('搜索无命中时仍播原条目，队列其余曲目不受影响', () => {
    const items = Array.from({ length: 10 }, (_, i) => hotItem(i));
    const result = buildHotlistQueue(items, 0, 'qq', null);

    expect(result.queue).toHaveLength(10);
    expect(result.song?.id).toBe('item-0');
    expect(result.song?.url).toBe('');
    expect(result.queue[1]?.sourceType).toBe('qq');
  });

  it('越界下标夹取到有效范围；空 section 返回空歌曲', () => {
    const items = [hotItem(0), hotItem(1)];
    const clamped = buildHotlistQueue(items, 99, 'netease');
    expect(clamped.index).toBe(1);
    expect(clamped.song?.id).toBe('item-1');

    const empty = buildHotlistQueue([], 0, 'netease');
    expect(empty.queue).toEqual([]);
    expect(empty.song).toBeNull();
  });

  it('hotlistItemToSong 保留时长与来源，url/lrc 留空等待解析', () => {
    const converted = hotlistItemToSong(hotItem(4), 'qq');
    expect(converted.duration).toBe(184);
    expect(converted.sourceType).toBe('qq');
    expect(converted.artist).toBe('测试歌手');
    expect(converted.url).toBe('');
    expect(converted.lrc).toBe('');
  });
});
