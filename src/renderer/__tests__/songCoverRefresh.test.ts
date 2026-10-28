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

    // song.cover 与缓存一致（刚 onError 失败的同一 URL）→ 缓存优先不命中，落回搜索路径
    await refreshSongCover({ ...baseSong, cover: 'https://old-cover.jpg', url: 'https://old-audio.example.com/a.mp3' });
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
    const searchCalls = () =>
      invoke.mock.calls.filter(([channel, method]) => channel === 'musicApi:call' && method === 'searchSongsRouted').length;

    await refreshSongCover(baseSong);
    const searchesAfterFirst = searchCalls();
    // 刚刷新过（60s 冷却）：第二次触发不再发起搜索；缓存读仍允许（本地、无上游成本）
    expect(await refreshSongCover(baseSong)).toBeNull();
    expect(searchCalls()).toBe(searchesAfterFirst);
  });

  it('冷却期内切页重挂仍从缓存水合封面（不因冷却整片回落灰底）', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const freshCover = 'https://img.example.com/cached-cover.jpg';
    let cached: { url: string; cover: string; lrc: string } | null = null;
    invoke.mockImplementation(async (channel: string, method?: string, arg?: unknown) => {
      if (channel === 'cache:getSongResources') return cached;
      if (channel === 'cache:setSongResources') {
        cached = arg as { url: string; cover: string; lrc: string };
        return null;
      }
      if (channel === 'musicApi:call' && method === 'searchSongsRouted') {
        return [{ ...baseSong, cover: freshCover }];
      }
      return null;
    });

    // 首次挂载：缓存空 → 上游搜索成功并写缓存
    expect(await refreshSongCover(baseSong)).toBe(freshCover);
    const commitsAfterFirst = invoke.mock.calls.length;

    // 切页返回：收藏重读只给 SongBase（cover 为空），仍在 60s 冷却内
    // 关键断言：缓存水合不受冷却影响，能直接把封面还给列表
    expect(await refreshSongCover({ ...baseSong, cover: '' })).toBe(freshCover);
    const searchCalls = invoke.mock.calls
      .slice(commitsAfterFirst)
      .filter(([channel, method]) => channel === 'musicApi:call' && method === 'searchSongsRouted').length;
    expect(searchCalls).toBe(0);
  });

  it('缓存已有可用封面直接复用零搜索（收藏/历史 cover 不落库，挂载触发不打上游）', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'cache:getSongResources') {
        return { url: 'https://cache-audio.example.com/a.mp3', cover: 'https://cache-cover.jpg', lrc: 'cache-lrc' };
      }
      return null;
    });

    const cover = await refreshSongCover(baseSong);
    expect(cover).toBe('https://cache-cover.jpg');
    // 缓存命中：完全不发起搜索，回写沿用缓存里的安全 url/lrc
    expect(invoke).not.toHaveBeenCalledWith('musicApi:call', expect.anything());
    expect(invoke).toHaveBeenCalledWith('cache:setSongResources', '3336112836', {
      url: 'https://cache-audio.example.com/a.mp3',
      cover: 'https://cache-cover.jpg',
      lrc: 'cache-lrc',
    });
  });

  it('缓存封面与传入 song.cover 相同（刚失败）时不复用缓存，仍走搜索', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockImplementation(async (channel: string, method?: string) => {
      if (channel === 'musicApi:call' && method === 'searchSongsRouted') {
        return [{ ...baseSong, cover: 'https://fresh-cover.jpg' }];
      }
      if (channel === 'cache:getSongResources') {
        return { url: '', cover: 'https://stale-cover.jpg', lrc: '' };
      }
      return null;
    });

    const cover = await refreshSongCover({ ...baseSong, cover: 'https://stale-cover.jpg' });
    expect(cover).toBe('https://fresh-cover.jpg');
    expect(invoke).toHaveBeenCalledWith('musicApi:call', 'searchSongsRouted', '晴天 周杰伦', 1, 'netease');
    expect(invoke).toHaveBeenCalledWith('cache:setSongResources', '3336112836', {
      url: '',
      cover: 'https://fresh-cover.jpg',
      lrc: '',
    });
  });

  it('缓存封面是 legacy 死链时视同未命中，仍走搜索', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const deadUrl = 'http://legacy.example.com/api.php?get=pic&sign=abc';
    invoke.mockImplementation(async (channel: string, method?: string) => {
      if (channel === 'musicApi:call' && method === 'searchSongsRouted') {
        return [{ ...baseSong, cover: 'https://fresh-cover.jpg' }];
      }
      if (channel === 'cache:getSongResources') {
        return { url: deadUrl, cover: deadUrl, lrc: '' };
      }
      return null;
    });

    const cover = await refreshSongCover(baseSong);
    expect(cover).toBe('https://fresh-cover.jpg');
    expect(invoke).toHaveBeenCalledWith('musicApi:call', 'searchSongsRouted', '晴天 周杰伦', 1, 'netease');
    // 死链 url/cover 不回写残留，全部被搜索结果/空串替换
    expect(invoke).toHaveBeenCalledWith('cache:setSongResources', '3336112836', {
      url: '',
      cover: 'https://fresh-cover.jpg',
      lrc: '',
    });
  });
});
