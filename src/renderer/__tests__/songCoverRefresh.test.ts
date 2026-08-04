import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn() },
}));
vi.mock('../services/coverCacheService', () => ({
  cacheCoverImage: vi.fn().mockResolvedValue(undefined),
}));

import { IpcClient } from '../services/IpcClient';
import { refreshSongCover } from '../utils/songCoverRefresh';
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
  });

  it('按源站 ID 识别成功返回新封面并更新 URL 缓存', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const freshCover = 'https://example.com/api.php?get=pic&type=wy&id=3336112836&sign=new&t=2';
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'musicApi:searchSongById') {
        return { ...baseSong, cover: freshCover, url: 'https://example.com/api.php?get=url&type=wy&id=3336112836', lrc: 'lrc-url' };
      }
      return null;
    });

    const cover = await refreshSongCover(baseSong);
    expect(cover).toBe(freshCover);
    expect(invoke).toHaveBeenCalledWith('musicApi:searchSongById', '3336112836', 'netease');
    expect(invoke).toHaveBeenCalledWith('cache:setUrl', '3336112836', {
      url: 'https://example.com/api.php?get=url&type=wy&id=3336112836',
      cover: freshCover,
      lrc: 'lrc-url',
    });
  });

  it('ID 识别失败时回退名字搜索严格匹配（防翻唱/Live 误配）', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const freshCover = 'https://example.com/api.php?get=pic&type=wy&id=3336112836&sign=new&t=2';
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'musicApi:searchSongById') return null;
      if (channel === 'musicApi:searchSongs') {
        return [
          { ...baseSong, name: '晴天 (Live)', artist: '周杰伦', cover: 'https://live-cover.jpg' },
          { ...baseSong, name: '晴天', artist: '周杰伦', cover: freshCover },
        ];
      }
      return null;
    });

    const cover = await refreshSongCover(baseSong);
    // 严格匹配命中同名同歌手，而不是 Live 版
    expect(cover).toBe(freshCover);
  });

  it('ID 与名字搜索都失败时返回 null', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'musicApi:searchSongById') return null;
      if (channel === 'musicApi:searchSongs') return [];
      return null;
    });

    const cover = await refreshSongCover(baseSong);
    expect(cover).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('cache:setUrl', expect.any(String), expect.any(Object));
  });

  it('local/soda 源不刷新', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const cover = await refreshSongCover({ ...baseSong, sourceType: 'local' });
    expect(cover).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('多层源前缀 ID 循环剥离后识别', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'musicApi:searchSongById') {
        return { ...baseSong, cover: 'https://fresh-cover.jpg' };
      }
      return null;
    });

    await refreshSongCover({ ...baseSong, id: 'kuwo:kugou:3336112836' });
    expect(invoke).toHaveBeenCalledWith('musicApi:searchSongById', '3336112836', 'netease');
  });
});
