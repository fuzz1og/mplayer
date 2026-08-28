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
    probeSongsBatch: vi.fn(async (songs: Song[]) => songs.map((s) => ({ songId: s.id, tag: 'valid' as const }))),
    getLyrics: vi.fn(async () => 'lrc text'),
    getSodaPlayableUrl: vi.fn(async (id: string) => `file:///${id}`),
    resolvePlaylistLink: vi.fn(async (url: string) => url),
    // 其余 core 方法空实现（占位，保证类型完整）
    getNeteaseHotlist: vi.fn(async () => []),
    getNeteaseNewSongList: vi.fn(async () => []),
    getQQHotlist: vi.fn(async () => []),
    getQQNewSongList: vi.fn(async () => []),
    getNeteasePlaylists: vi.fn(async () => ({ playlists: [], total: 0, more: false })),
    getNeteasePlaylistDetail: vi.fn(async () => null),
    getNeteasePlaylistSongs: vi.fn(async () => []),
    getNeteasePlaylistSongsPage: vi.fn(async () => ({ songs: [], total: 0 })),
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
    searchSongsRouted: vi.fn(async () => []),
    resolvePlayableUrlRouted: vi.fn(async () => ''),
    resolvePlayableSongRouted: vi.fn(async () => ({ url: '', nonFull: false })),
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

    const result = await handler({}, 'getLyrics', 'http://x/lrc');

    expect(api.getLyrics).toHaveBeenCalledWith('http://x/lrc');
    expect(result).toEqual({ success: true, data: 'lrc text' });
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
    (api.getLyrics as any).mockRejectedValueOnce(new Error('网络错误'));
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'getLyrics', 'http://x/lrc');

    expect(api.getLyrics).toHaveBeenCalledWith('http://x/lrc');
    expect(result).toEqual({ success: false, error: '网络错误' });
  });

  it('getSodaPlayableUrl 转发 main 扩展对象', async () => {
    const api = makeApi({ getSodaPlayableUrl: vi.fn(async (id: string) => `file:///${id}`) });
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'getSodaPlayableUrl', 't1');
    expect(api.getSodaPlayableUrl).toHaveBeenCalledWith('t1');
    expect(result).toEqual({ success: true, data: 'file:///t1' });
  });

  it('resolvePlaylistLink 转发 main 扩展对象', async () => {
    const api = makeApi({
      resolvePlaylistLink: vi.fn(async () => 'https://music.163.com/playlist?id=42'),
    });
    registerMusicApiCall(api as any);
    const handler = getCallHandler();

    const result = await handler({}, 'resolvePlaylistLink', 'https://163cn.tv/abc');
    expect(api.resolvePlaylistLink).toHaveBeenCalledWith('https://163cn.tv/abc');
    expect(result).toEqual({ success: true, data: 'https://music.163.com/playlist?id=42' });
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
