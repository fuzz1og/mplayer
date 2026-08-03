import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSourceStore } from '../stores/sourceStore';
import { useSearchStore } from '../stores/searchStore';

// musicApi 打桩记录调用参数,createSearchController 用真实实现(纯逻辑)
const mocks = vi.hoisted(() => ({
  searchSongs: vi.fn(async () => []),
  searchAllSources: vi.fn(async () => []),
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

  it('searches each source progressively when source is all (no searchAllSources)', async () => {
    useSourceStore.getState().setSelectedSource('all');
    await useSearchStore.getState().search('晴天');
    // 渐进式：逐源调用 searchSongs（每源完成立即渲染，不等最慢源）
    expect(mocks.searchAllSources).not.toHaveBeenCalled();
    const calls = mocks.searchSongs.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // 每个调用都是 ('晴天', 1, <源>)
    for (const [kw, page, src] of calls) {
      expect(kw).toBe('晴天');
      expect(page).toBe(1);
      expect(['netease', 'qq', 'kugou', 'kuwo', 'qianqian', 'soda']).toContain(src);
    }
  });
});
