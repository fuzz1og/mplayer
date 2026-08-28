import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAggregatedChart } from '../../main/services/chartAggregator';
import { cacheManager, registerDirectClient, clearDirectClients } from '@mplayer/core';
import type { Song, ToplistGroup } from '@mplayer/core';

// 三源榜单均走能力面 getToplists（#278 网易/酷狗 + #279 QQ）：经 core 注册表注入
// 假直连客户端（#286 起壳层改调 core getToplistSongs，取组/无客户端抛错在 core 内真实执行）
const neteaseGetToplists = vi.fn();
const qqGetToplists = vi.fn();
const kugouGetToplists = vi.fn();

vi.mock('@mplayer/core', async () => {
  const actual = await vi.importActual<typeof import('@mplayer/core')>('@mplayer/core');
  return {
    ...actual,
    cacheManager: {
      get: vi.fn(),
      set: vi.fn(),
    },
  };
});

const songOf = (source: Song['sourceType'], over: Partial<Song> & { id: string; name: string }): Song => ({
  artist: '',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 0,
  sourceType: source,
  ...over,
});

const neteaseGroups = (hot: Song[]): ToplistGroup[] => [
  { id: 'netease:3778678', name: '热歌榜', songs: hot },
  { id: 'netease:3779629', name: '新歌榜', songs: [] },
];
const qqGroups = (hot: Song[]): ToplistGroup[] => [
  { id: 'qq:26', name: '热歌榜', songs: hot },
  { id: 'qq:27', name: '新歌榜', songs: [] },
];
const kugouGroups = (hot: Song[]): ToplistGroup[] => [
  { id: 'kugou:8888', name: '热歌榜', songs: hot },
  { id: 'kugou:74534', name: '新歌榜', songs: [] },
];

describe('chartAggregator（#279 接 core aggregateChartSongs 内核）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cacheManager.get).mockReturnValue(null);
    clearDirectClients();
    registerDirectClient({ key: 'netease', getToplists: neteaseGetToplists });
    registerDirectClient({ key: 'qq', getToplists: qqGetToplists });
    registerDirectClient({ key: 'kugou', getToplists: kugouGetToplists });
  });

  it('单源上榜歌：sourceRanks 只含上榜源（内核语义，不再 1/51 预填），score = Σ1/rank', async () => {
    neteaseGetToplists.mockResolvedValue(neteaseGroups([
      songOf('netease', { id: 'n1', name: 'Song A', artist: 'Artist A' }),
    ]));
    qqGetToplists.mockResolvedValue(qqGroups([]));
    kugouGetToplists.mockResolvedValue(kugouGroups([]));

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].sourceRanks).toEqual({ netease: 1 });
    expect(result.songs[0].score).toBeCloseTo(1);
    expect(result.total).toBe(1);
  });

  it('跨源同名同歌手合并，同组选优按排名（QQ rank 1 胜网易 rank 2）', async () => {
    neteaseGetToplists.mockResolvedValue(neteaseGroups([
      songOf('netease', { id: 'n0', name: 'Song X', artist: 'Artist X' }),
      songOf('netease', { id: 'n1', name: 'Song B', artist: 'Artist B' }),
    ]));
    qqGetToplists.mockResolvedValue(qqGroups([
      songOf('qq', { id: 'q1', name: 'Song B', artist: 'Artist B' }),
    ]));
    kugouGetToplists.mockResolvedValue(kugouGroups([]));

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(2);
    const merged = result.songs.find((g) => g.name === 'Song B');
    expect(merged).toBeDefined();
    expect(merged!.sourceRanks).toEqual({ netease: 2, qq: 1 });
    expect(merged!.score).toBeCloseTo(1 / 2 + 1);
    expect(merged!.bestSong.sourceType).toBe('qq');
  });

  it('失败/未实现的源整体跳过：其歌不进聚合，也不占缺省权重', async () => {
    neteaseGetToplists.mockResolvedValue(neteaseGroups([
      songOf('netease', { id: 'n1', name: 'Song C', artist: 'Artist C' }),
    ]));
    qqGetToplists.mockResolvedValue(qqGroups([]));
    kugouGetToplists.mockRejectedValue(new Error('kugou down'));

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].name).toBe('Song C');
    expect(result.songs[0].sourceRanks).toEqual({ netease: 1 });
    expect(result.songs[0].sourceRanks).not.toHaveProperty('kugou');
  });

  it('按榜型 id 取歌：hot 取 26/8888/3778678，new 取 27/74534/3779629', async () => {
    neteaseGetToplists.mockResolvedValue([
      { id: 'netease:3778678', name: '热歌榜', songs: [songOf('netease', { id: 'nh', name: 'NeteaseHot' })] },
      { id: 'netease:3779629', name: '新歌榜', songs: [songOf('netease', { id: 'nn', name: 'NeteaseNew' })] },
    ] as ToplistGroup[]);
    qqGetToplists.mockResolvedValue([
      { id: 'qq:26', name: '热歌榜', songs: [songOf('qq', { id: 'qh', name: 'QQHot' })] },
      { id: 'qq:27', name: '新歌榜', songs: [songOf('qq', { id: 'qn', name: 'QQNew' })] },
    ] as ToplistGroup[]);
    kugouGetToplists.mockResolvedValue(kugouGroups([]));

    const hot = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);
    expect(hot.songs.map((g) => g.name)).toContain('NeteaseHot');
    expect(hot.songs.map((g) => g.name)).toContain('QQHot');
    expect(hot.songs.map((g) => g.name)).not.toContain('NeteaseNew');

    const fresh = await getAggregatedChart('new', ['netease', 'qq', 'kugou']);
    expect(fresh.songs.map((g) => g.name)).toContain('QQNew');
    expect(fresh.songs.map((g) => g.name)).not.toContain('QQHot');
  });
});
