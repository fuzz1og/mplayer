import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAggregatedChart } from '../../main/services/chartAggregator';
import { musicApi } from '../../main/api/musicApi';
import { getKugouRank } from '../../main/api/kugouApi';
import { cacheManager } from '@mplayer/core';

vi.mock('../../main/api/musicApi', () => ({
  musicApi: {
    getNeteaseHotlist: vi.fn(),
    getNeteaseNewSongList: vi.fn(),
    getQQHotlist: vi.fn(),
    getQQNewSongList: vi.fn(),
  },
}));

vi.mock('../../main/api/kugouApi', () => ({
  getKugouRank: vi.fn(),
  getKugouNewSongs: vi.fn(),
}));

vi.mock('@mplayer/core', () => ({
  cacheManager: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe('chartAggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cacheManager.get).mockReturnValue(null);
  });

  it('adds DEFAULT_MISS for sources that did not rank a song', async () => {
    vi.mocked(musicApi.getNeteaseHotlist).mockResolvedValue([
      { id: 'n1', name: 'Song A', artists: 'Artist A', cover: '', rank: 1, album: '' } as any,
    ]);
    vi.mocked(musicApi.getQQHotlist).mockResolvedValue([] as any);
    vi.mocked(getKugouRank).mockResolvedValue([] as any);

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].sourceRanks).toEqual({ netease: 1, qq: 51, kugou: 51 });
    expect(result.songs[0].score).toBeCloseTo(1 + 1 / 51 + 1 / 51);
  });

  it('merges the same song across sources and prefers the better rank', async () => {
    vi.mocked(musicApi.getNeteaseHotlist).mockResolvedValue([
      { id: 'n1', name: 'Song B', artists: 'Artist B', cover: '', rank: 3, album: '' } as any,
    ]);
    vi.mocked(musicApi.getQQHotlist).mockResolvedValue([
      { id: 'q1', name: 'Song B', artists: 'Artist B', cover: '', rank: 1, album: '' } as any,
    ]);
    vi.mocked(getKugouRank).mockResolvedValue([] as any);

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].sourceRanks).toEqual({ netease: 3, qq: 1, kugou: 51 });
    expect(result.songs[0].bestSong.sourceType).toBe('qq');
  });

  it('omits failed sources from sourceRanks', async () => {
    vi.mocked(musicApi.getNeteaseHotlist).mockResolvedValue([
      { id: 'n1', name: 'Song C', artists: 'Artist C', cover: '', rank: 2, album: '' } as any,
    ]);
    vi.mocked(musicApi.getQQHotlist).mockResolvedValue([] as any);
    vi.mocked(getKugouRank).mockRejectedValue(new Error('kugou down'));

    const result = await getAggregatedChart('hot', ['netease', 'qq', 'kugou']);

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].sourceRanks).toEqual({ netease: 2, qq: 51 });
    expect(result.songs[0].score).toBeCloseTo(1 / 2 + 1 / 51);
  });
});
