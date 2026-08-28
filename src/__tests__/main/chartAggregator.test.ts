import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAggregatedChart } from '../../main/services/chartAggregator';
import { musicApi } from '../../main/api/musicApi';
import { cacheManager } from '@mplayer/core';

// 网易/酷狗榜单已迁能力面（#278）：mock 直连客户端 getToplists
const neteaseGetToplists = vi.fn();
const kugouGetToplists = vi.fn();

vi.mock('../../main/api/musicApi', () => ({
  musicApi: {
    getQQHotlist: vi.fn(),
    getQQNewSongList: vi.fn(),
  },
}));

vi.mock('@mplayer/core', () => ({
  cacheManager: {
    get: vi.fn(),
    set: vi.fn(),
  },
  getDirectClient: (key: string) => {
    if (key === 'netease') return { key: 'netease', getToplists: neteaseGetToplists };
    if (key === 'kugou') return { key: 'kugou', getToplists: kugouGetToplists };
    return undefined;
  },
  musicApi: {},
}));

const neteaseSongs = (songs: Record<string, unknown>[]) =>
  songs.map((s) => ({ id: s.id, name: s.name, artist: s.artists, cover: s.cover, album: s.album, url: '', lrc: '', duration: 0, sourceType: 'netease' }));
const neteaseGroups = (songs: Record<string, unknown>[]) => [
  { id: 'netease:3778678', name: '热歌榜', songs: neteaseSongs(songs) },
  { id: 'netease:3779629', name: '新歌榜', songs: [] },
];
const kugouGroups = (songs: Record<string, unknown>[]) => [
  { id: 'kugou:8888', name: '热歌榜', songs: songs.map((s) => ({ id: s.id, name: s.name, artist: s.artists, cover: s.cover, album: s.album, url: '', lrc: '', duration: 0, sourceType: 'kugou' })) },
  { id: 'kugou:74534', name: '新歌榜', songs: [] },
];

describe('chartAggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cacheManager.get).mockReturnValue(null);
  });

  it('adds DEFAULT_MISS for sources that did not rank a song', async () => {
    neteaseGetToplists.mockResolvedValue(neteaseGroups([
      { id: 'n1', name: 'Song A', artists: 'Artist A', cover: '', rank: 1, album: '' },
    ]));
    vi.mocked(musicApi.getQQHotlist).mockResolvedValue([] as any);
    kugouGetToplists.mockResolvedValue(kugouGroups([]));

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].sourceRanks).toEqual({ netease: 1, qq: 51, kugou: 51 });
    expect(result.songs[0].score).toBeCloseTo(1 + 1 / 51 + 1 / 51);
  });

  it('merges the same song across sources and prefers the better rank', async () => {
    // rank 由索引推导（#239）：网易榜 Song B 落在第 2 位（第 1 位是别首歌），
    // QQ 榜 Song B 在第 1 位 → 同组选优 QQ 胜出
    neteaseGetToplists.mockResolvedValue(neteaseGroups([
      { id: 'n0', name: 'Song X', artists: 'Artist X', cover: '', rank: 1, album: '' },
      { id: 'n1', name: 'Song B', artists: 'Artist B', cover: '', rank: 2, album: '' },
    ]));
    vi.mocked(musicApi.getQQHotlist).mockResolvedValue([
      { id: 'q1', name: 'Song B', artists: 'Artist B', cover: '', rank: 1, album: '' } as any,
    ]);
    kugouGetToplists.mockResolvedValue(kugouGroups([]));

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(2);
    const merged = result.songs.find((g) => g.name === 'Song B');
    expect(merged).toBeDefined();
    expect(merged!.sourceRanks).toEqual({ netease: 2, qq: 1, kugou: 51 });
    expect(merged!.bestSong.sourceType).toBe('qq');
  });

  it('omits failed sources from sourceRanks', async () => {
    neteaseGetToplists.mockResolvedValue(neteaseGroups([
      { id: 'n0', name: 'Song X', artists: 'Artist X', cover: '', rank: 1, album: '' },
      { id: 'n1', name: 'Song C', artists: 'Artist C', cover: '', rank: 2, album: '' },
    ]));
    vi.mocked(musicApi.getQQHotlist).mockResolvedValue([] as any);
    kugouGetToplists.mockRejectedValue(new Error('kugou down'));

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(2);
    const merged = result.songs.find((g) => g.name === 'Song C');
    expect(merged).toBeDefined();
    expect(merged!.sourceRanks).toEqual({ netease: 2, qq: 51 });
    expect(merged!.score).toBeCloseTo(1 / 2 + 1 / 51);
  });
});
