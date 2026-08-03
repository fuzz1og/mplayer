import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSourceStore } from '../stores/sourceStore';
import { useSearchStore } from '../stores/searchStore';

// musicApi 打桩记录调用参数,createSearchController 用真实实现(纯逻辑)
const mocks = vi.hoisted(() => ({
  searchSongs: vi.fn(async (_kw: string, _page: number, _src: string): Promise<any[]> => []),
  searchAllSources: vi.fn(async (): Promise<any[]> => []),
}));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  return {
    ...actual,
    musicApi: {
      ...actual.musicApi,
      searchSongs: mocks.searchSongs,
      searchAllSources: mocks.searchAllSources,
    },
  };
});

vi.mock('../services/audioProbe', () => ({
  probeAudio: vi.fn(async () => 'ok'),
}));

beforeEach(() => {
  mocks.searchSongs.mockClear();
  mocks.searchAllSources.mockClear();
  useSourceStore.getState().setSelectedSource('all');
  useSearchStore.getState().clear();
});

describe('searchStore source routing', () => {
  it('passes the selected single source to searchSongs (regression: c64f05a)', async () => {
    useSourceStore.getState().setSelectedSource('qq');
    await useSearchStore.getState().search('晴天');
    expect(mocks.searchSongs).toHaveBeenCalledWith('晴天', 1, 'qq');
    expect(mocks.searchAllSources).not.toHaveBeenCalled();
  });

  it('uses searchAllSources when source is all', async () => {
    useSourceStore.getState().setSelectedSource('all');
    await useSearchStore.getState().search('晴天');
    expect(mocks.searchAllSources).toHaveBeenCalledWith('晴天', 1);
    expect(mocks.searchSongs).not.toHaveBeenCalled();
  });
});
