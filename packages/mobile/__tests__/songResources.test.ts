import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';

// musicApi 搜索打桩；cacheService 打桩（移动端口注入）：适配器只负责接线，
// 编排规则（精确匹配守卫 / nonFull 保留 / 失败打开）由 core 单测覆盖。
const mocks = vi.hoisted(() => ({
  searchSongsRouted: vi.fn(async (): Promise<any[]> => []),
  readCache: vi.fn(async (): Promise<any> => null),
  writeCache: vi.fn(async () => {}),
}));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  return {
    ...actual,
    musicApi: { ...actual.musicApi, searchSongsRouted: mocks.searchSongsRouted },
  };
});

vi.mock('../services/cacheService', () => ({
  getCachedResource: mocks.readCache,
  setCachedResource: mocks.writeCache,
}));

import { refreshPlayableResource, searchStrictMatch } from '../services/songResources';

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: '123',
    name: '晴天',
    artist: '周杰伦',
    album: '',
    url: '',
    cover: '',
    lrc: '',
    duration: 240,
    sourceType: 'netease',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.searchSongsRouted.mockReset().mockResolvedValue([]);
  mocks.readCache.mockReset().mockResolvedValue(null);
  mocks.writeCache.mockReset().mockResolvedValue(undefined);
});

describe('refreshPlayableResource（core 刷新编排的移动适配器）', () => {
  it('a. 缓存命中且非死链 → 直接返回，不搜索', async () => {
    mocks.readCache.mockResolvedValueOnce({ url: 'https://cached.example.com/a.mp3', nonFull: true, ts: 7 });

    await expect(refreshPlayableResource(song())).resolves.toEqual({
      url: 'https://cached.example.com/a.mp3',
      nonFull: true,
      ts: 7,
    });
    expect(mocks.searchSongsRouted).not.toHaveBeenCalled();
    expect(mocks.writeCache).not.toHaveBeenCalled();
  });

  it('a. 缓存命中但是旧签名死链 → 继续搜索', async () => {
    mocks.readCache.mockResolvedValueOnce({
      url: 'https://api.example.com/api.php?get=url&id=1',
      nonFull: false,
      ts: 1,
    });
    mocks.searchSongsRouted.mockResolvedValueOnce([song({ url: 'https://fresh.example.com/a.mp3' })]);

    await expect(refreshPlayableResource(song())).resolves.toMatchObject({
      url: 'https://fresh.example.com/a.mp3',
    });
    expect(mocks.searchSongsRouted).toHaveBeenCalledWith('晴天 周杰伦', 1, 'netease');
  });

  it('b/c. 未命中 → 路由严格搜索，精确匹配采用并回写（preview → nonFull 保留）', async () => {
    mocks.searchSongsRouted.mockResolvedValueOnce([
      song({ url: 'https://matched.example.com/a.mp3', audioTag: 'preview' as const }),
    ]);

    await expect(refreshPlayableResource(song())).resolves.toMatchObject({
      url: 'https://matched.example.com/a.mp3',
      nonFull: true,
    });
    expect(mocks.writeCache).toHaveBeenCalledWith(
      expect.objectContaining({ id: '123' }),
      expect.objectContaining({ url: 'https://matched.example.com/a.mp3', nonFull: true }),
    );
  });

  it('b. 非精确匹配（同名不同歌手）→ null 且不写缓存', async () => {
    mocks.searchSongsRouted.mockResolvedValueOnce([
      song({ artist: '翻唱歌手', url: 'https://wrong.example.com/a.mp3' }),
    ]);

    await expect(refreshPlayableResource(song())).resolves.toBeNull();
    expect(mocks.writeCache).not.toHaveBeenCalled();
  });

  it('e. 搜索抛错 → 失败打开返回 null，不抛给调用方', async () => {
    mocks.searchSongsRouted.mockRejectedValueOnce(new Error('搜索失败'));

    await expect(refreshPlayableResource(song())).resolves.toBeNull();
    expect(mocks.writeCache).not.toHaveBeenCalled();
  });
});

describe('searchStrictMatch（对外签名不变）', () => {
  it('仍返回精确匹配候选，非精确候选被拒', async () => {
    mocks.searchSongsRouted.mockResolvedValueOnce([
      song({ artist: '翻唱歌手', url: 'https://wrong.example.com/a.mp3' }),
      song({ url: 'https://right.example.com/a.mp3' }),
    ]);

    await expect(searchStrictMatch(song())).resolves.toMatchObject({
      url: 'https://right.example.com/a.mp3',
    });
  });
});
