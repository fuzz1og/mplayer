import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn() },
}));

import { IpcClient } from '../services/IpcClient';
import { refreshSongCover, __resetSongCoverRefreshState } from '../utils/songCoverRefresh';
import type { Song } from '@mplayer/core';

const baseSong: Song = {
  id: '3336112836',
  name: '晴天',
  artist: '周杰伦',
  sourceType: 'netease',
  url: '',
  cover: '',
  lrc: '',
};

describe('refreshSongCover 封面失败刷新', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置会话级刷新状态（attempts 计数/60s 冷却），否则同 id 用例被冷却挡住
    __resetSongCoverRefreshState();
  });

  it('名字搜索严格匹配命中返回新封面并更新 URL 缓存（防翻唱/Live 误配）', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const freshCover = 'https://img.example.com/new-cover.jpg';
    invoke.mockImplementation(async (channel: string, method?: string) => {
      if (channel === 'musicApi:call' && method === 'searchSongsRouted') {
        return [
          { ...baseSong, name: '晴天 (Live)', artist: '周杰伦', cover: 'https://live-cover.jpg' },
          { ...baseSong, name: '晴天', artist: '周杰伦', cover: freshCover, url: 'https://audio.example.com/new.mp3', lrc: 'lrc-url' },
        ];
      }
      return null;
    });

    const cover = await refreshSongCover(baseSong);
    // 严格匹配命中同名同歌手，而不是 Live 版；不发起 searchSongById（死腿已删）
    expect(cover).toBe(freshCover);
    expect(invoke).toHaveBeenCalledWith('musicApi:call', 'searchSongsRouted', '晴天 周杰伦', 1, 'netease');
    expect(invoke).not.toHaveBeenCalledWith('musicApi:call', 'searchSongById', expect.anything());
    expect(invoke).toHaveBeenCalledWith('cache:setSongResources', '3336112836', {
      url: 'https://audio.example.com/new.mp3',
      cover: freshCover,
      lrc: 'lrc-url',
    });
  });

  it('更新 URL 缓存只替换封面：搜索结果 url 为空时保留已有 url/lrc', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockImplementation(async (channel: string, method?: string, arg?: unknown) => {
      if (channel === 'musicApi:call' && method === 'searchSongsRouted') {
        return [{ ...baseSong, cover: 'https://fresh-cover.jpg' }];
      }
      if (channel === 'cache:getSongResources') {
        return { url: 'https://old-audio.example.com/a.mp3', cover: 'https://old-cover.jpg', lrc: 'old-lrc' };
      }
      void arg;
      return null;
    });

    await refreshSongCover({ ...baseSong, url: 'https://old-audio.example.com/a.mp3' });
    expect(invoke).toHaveBeenCalledWith('cache:setSongResources', '3336112836', {
      url: 'https://old-audio.example.com/a.mp3',
      cover: 'https://fresh-cover.jpg',
      lrc: 'old-lrc',
    });
  });

  it('名字搜索无精确匹配时返回 null，不写缓存', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockImplementation(async (channel: string, method?: string) => {
      if (channel === 'musicApi:call' && method === 'searchSongsRouted') return [];
      return null;
    });

    const cover = await refreshSongCover(baseSong);
    expect(cover).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('cache:setSongResources', expect.any(String), expect.any(Object));
  });

  it('local/soda 源不刷新', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const cover = await refreshSongCover({ ...baseSong, sourceType: 'local' });
    expect(cover).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('冷却期内重复触发不再发起搜索（防刷新风暴）', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockImplementation(async (channel: string, method?: string) => {
      if (channel === 'musicApi:call' && method === 'searchSongsRouted') return [];
      return null;
    });

    await refreshSongCover(baseSong);
    const callsAfterFirst = invoke.mock.calls.length;
    // 刚刷新过（60s 冷却）：第二次触发直接跳过，不再发起搜索
    await refreshSongCover(baseSong);
    expect(invoke.mock.calls.length).toBe(callsAfterFirst);
  });
});
