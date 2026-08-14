import { beforeEach, describe, expect, it, vi } from 'vitest';

// 本文件在 renderer(config jsdom) 与 main 配置下都会运行，需自带 electron mock
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-user-data' },
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { MusicApiMethodMap } from '@/shared/musicApiContract';
import type { Song } from '@mplayer/core';

// mock core api 依赖
vi.mock('../../main/services/chartAggregator', () => ({
  getAggregatedChart: vi.fn(async (type: string) => ({ songs: [], total: 0, type })),
}));

vi.mock('../../main/api/musicApi', () => ({
  getThrottleWaitMs: vi.fn(() => 1234),
}));

vi.mock('../../main/ipc/cache', () => ({
  cacheResolvedCover: vi.fn(async () => {}),
}));

import { registerMusicApiCall } from '../../main/ipc/musicApiHandlers';

/** 拿到 ipcMain.handle('musicApi:call', ...) 注册的处理器 */
function getCallHandler() {
  const handleArgs = vi.mocked(ipcMain.handle).mock.calls.find(
    (c) => c[0] === 'musicApi:call',
  );
  if (!handleArgs) throw new Error('musicApi:call handler not registered');
  return handleArgs[1] as (event: unknown, method: string, ...args: unknown[]) => Promise<unknown>;
}

function makeApi(methods: Partial<Record<keyof MusicApiMethodMap, unknown>>) {
  return {
    searchSongs: vi.fn(async () => [{ id: '1', name: '晴天' } as Song]),
    getAudioUrl: vi.fn(async (url: string) => `resolved:${url}`),
    probeSongsBatch: vi.fn(async (songs: Song[]) => songs.map((s) => ({ songId: s.id, tag: 'valid' as const }))),
    getLyrics: vi.fn(async () => 'lrc text'),
    resolveCoverUrl: vi.fn(async (url: string) => url),
    invalidateCoverUrl: vi.fn(),
    fillSongUrls: vi.fn(async (songs: Song[]) => songs),
    getSodaPlayableUrl: vi.fn(async (id: string) => `file:///${id}`),
    // 其余 core 方法空实现（占位，保证类型完整）
    searchSongById: vi.fn(async () => null),
    batchSearch: vi.fn(async () => ({})),
    getNeteaseHotlist: vi.fn(async () => []),
    getNeteaseNewSongList: vi.fn(async () => []),
    getQQHotlist: vi.fn(async () => []),
    getQQNewSongList: vi.fn(async () => []),
    getNeteasePlaylists: vi.fn(async () => ({ playlists: [], total: 0, more: false })),
    getNeteasePlaylistDetail: vi.fn(async () => null),
    getNeteasePlaylistSongs: vi.fn(async () => []),
    getNeteasePlaylistSongsPage: vi.fn(async () => ({ songs: [], total: 0 })),
    getPlaylistSongsFromThirdParty: vi.fn(async () => []),
    getNeteaseArtists: vi.fn(async () => ({ artists: [], total: 0, more: false })),
    getNeteaseArtistSongs: vi.fn(async () => ({ songs: [], total: 0 })),
    searchNeteaseArtists: vi.fn(async () => []),
    getNewAlbums: vi.fn(async () => []),
    getAlbumDetail: vi.fn(async () => null),
    getArtistAlbums: vi.fn(async () => ({ albums: [], total: 0, more: false })),
    getRecommendedPlaylists: vi.fn(async () => []),
    getRecommendedSongs: vi.fn(async () => []),
    getSodaAudioUrl: vi.fn(async () => ''),
    parseSodaShareLink: vi.fn(async () => null),
    ...methods,
  };
}

describe('musicApi:call 单通道分发表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('转发 core 方法并返回成功封套', async () => {
    const api = makeApi({});
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'searchSongs', '晴天', 1, 'netease');

    expect(api.searchSongs).toHaveBeenCalledWith('晴天', 1, 'netease');
    expect(result).toEqual({ success: true, data: [{ id: '1', name: '晴天' }] });
  });

  it('未知方法返回失败封套，不抛异常', async () => {
    const api = makeApi({});
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'notARealMethod', 1, 2);

    expect(result).toEqual({ success: false, error: 'unknown musicApi method: notARealMethod' });
  });

  it('core 方法抛错时返回失败封套', async () => {
    const api = makeApi({});
    (api.getAudioUrl as any).mockRejectedValueOnce(new Error('网络错误'));
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'getAudioUrl', 'http://x.mp3');

    expect(api.getAudioUrl).toHaveBeenCalledWith('http://x.mp3', undefined);
    expect(result).toEqual({ success: false, error: '网络错误' });
  });

  it('main 独有方法 getThrottleWait 转发', async () => {
    const api = makeApi({});
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'getThrottleWait');
    expect(result).toEqual({ success: true, data: 1234 });
  });

  it('getSodaPlayableUrl 转发 main 扩展对象', async () => {
    const api = makeApi({ getSodaPlayableUrl: vi.fn(async (id: string) => `file:///${id}`) });
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'getSodaPlayableUrl', 't1');
    expect(api.getSodaPlayableUrl).toHaveBeenCalledWith('t1');
    expect(result).toEqual({ success: true, data: 'file:///t1' });
  });

  it('probeSongsBatch 转发空 url 保留 invalid 语义（交由 core 内实现）', async () => {
    const api = makeApi({});
    (api.probeSongsBatch as any).mockResolvedValueOnce([{ songId: '1', tag: 'invalid' }]);
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'probeSongsBatch', [{ id: '1', url: '' }]);
    expect(api.probeSongsBatch).toHaveBeenCalledWith([{ id: '1', url: '' }]);
    expect(result).toEqual({ success: true, data: [{ songId: '1', tag: 'invalid' }] });
  });
});
