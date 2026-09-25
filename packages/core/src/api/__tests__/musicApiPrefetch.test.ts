import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import { musicApi } from '../musicApi.js';
import { clearPrefetchCache, getPrefetchedUrl, setPrefetchedUrl } from '../prefetchCache.js';
import { clearDirectClients, registerDirectClient, setDirectValidator } from '../../shared/sourceRouter.js';

/**
 * musicApi.prefetchPlayableSong / forgetPrefetchedSong（#390）。
 *
 * 这层是「预取必须写到**读路径那一份**缓存」的落点：桌面经 `musicApi:call` 在
 * 主进程执行本方法，写的正是播放解析（`resolvePlayableSongRouted`）读的那份
 * `prefetchCache`。这里用同一个模块实例直接验证「写 → 读命中 0 上游请求」。
 */

const song = (overrides: Partial<Song> = {}): Song => ({
  id: 'qq:1',
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 240,
  sourceType: 'qq',
  ...overrides,
});

beforeEach(() => {
  clearPrefetchCache();
  clearDirectClients();
  // #392 直连腿取证默认会真发 Range：本文件只验预取/读路径，关闭以保持零 I/O。
  setDirectValidator(null);
});

describe('musicApi.prefetchPlayableSong（#390：#390 预取落读路径）', () => {
  it('解析成功写入预取缓存 → resolvePlayableSongRouted 命中同一条 URL 且不再打上游', async () => {
    const resolvePlayableUrl = vi.fn(async () => 'https://cdn.example.com/a.mp3');
    registerDirectClient({ key: 'qq', resolvePlayableUrl });

    const out = await musicApi.prefetchPlayableSong(song());

    expect(out).toEqual({ url: 'https://cdn.example.com/a.mp3', nonFull: false });
    expect(getPrefetchedUrl(song())?.url).toBe('https://cdn.example.com/a.mp3');

    const routed = await musicApi.resolvePlayableSongRouted(song());
    expect(routed).toMatchObject({ url: 'https://cdn.example.com/a.mp3', via: 'direct' });
    // 读路径命中预取 → 上游只被打过一次
    expect(resolvePlayableUrl).toHaveBeenCalledTimes(1);
  });

  it('已有未过期条目 → 直接复用，不发起解析', async () => {
    const resolvePlayableUrl = vi.fn(async () => 'https://cdn.example.com/new.mp3');
    registerDirectClient({ key: 'qq', resolvePlayableUrl });
    setPrefetchedUrl(song(), 'https://cdn.example.com/cached.mp3', false);

    const out = await musicApi.prefetchPlayableSong(song());

    expect(out).toEqual({ url: 'https://cdn.example.com/cached.mp3', nonFull: false });
    expect(resolvePlayableUrl).not.toHaveBeenCalled();
  });

  it('解析拿不到 URL → 不写缓存，返回 null（invalid 不入缓存）', async () => {
    registerDirectClient({ key: 'qq', resolvePlayableUrl: vi.fn(async () => '') });

    expect(await musicApi.prefetchPlayableSong(song())).toBeNull();
    expect(getPrefetchedUrl(song())).toBeUndefined();
  });

  it('forgetPrefetchedSong 清掉该歌条目（fresh 重试的遗忘语义）', () => {
    setPrefetchedUrl(song(), 'https://cdn.example.com/dead.mp3', false);
    musicApi.forgetPrefetchedSong(song());
    expect(getPrefetchedUrl(song())).toBeUndefined();
  });
});
