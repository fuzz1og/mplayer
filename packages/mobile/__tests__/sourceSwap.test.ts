import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song, SourceKey } from '@mplayer/core';
import { swapSongsToSource, countSwapped } from '../services/sourceSwap';

const musicApiMock = vi.hoisted(() => ({
  searchSongs: vi.fn(async (_kw: string, _page: number, _source: SourceKey): Promise<Song[]> => []),
}));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  return {
    ...actual,
    musicApi: { ...actual.musicApi, searchSongs: musicApiMock.searchSongs },
  };
});

function neteaseSong(id: string, name: string): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url: 'https://audio.example.com/preview.mp3', cover: '', lrc: '' };
}

function qqSong(id: string, name: string): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType: 'qq', url: 'https://audio.qq.com/full.mp3', cover: '', lrc: '' };
}

beforeEach(() => {
  musicApiMock.searchSongs.mockReset();
  musicApiMock.searchSongs.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('swapSongsToSource', () => {
  it('swaps each song to the target source via search + best match', async () => {
    musicApiMock.searchSongs.mockImplementation(async (kw: string, _page: number, source: SourceKey) => {
      if (source !== 'qq') return [];
      const name = kw.split(' ')[0];
      return [qqSong(`qq-${name}`, name)];
    });

    const swapped = await swapSongsToSource([neteaseSong('1', '晴天'), neteaseSong('2', '七里香')], 'qq');

    expect(swapped).toHaveLength(2);
    expect(swapped[0].sourceType).toBe('qq');
    expect(swapped[0].url).toContain('audio.qq.com');
    expect(swapped[0].id).toBe('qq:1'); // 保留原 id 前缀避免冲突
    expect(swapped[1].id).toBe('qq:2');
    expect(musicApiMock.searchSongs).toHaveBeenCalledTimes(2);
    expect(countSwapped([neteaseSong('1', '晴天'), neteaseSong('2', '七里香')], swapped)).toBe(2);
  });

  it('keeps the original song when no match is found', async () => {
    musicApiMock.searchSongs.mockResolvedValue([]);

    const original = [neteaseSong('1', '晴天')];
    const swapped = await swapSongsToSource(original, 'qq');

    expect(swapped[0]).toBe(original[0]);
    expect(countSwapped(original, swapped)).toBe(0);
  });

  it('keeps songs already on the target source untouched', async () => {
    const original = [qqSong('q1', '晴天')];
    const swapped = await swapSongsToSource(original, 'qq');

    expect(swapped[0]).toBe(original[0]);
    expect(musicApiMock.searchSongs).not.toHaveBeenCalled();
  });
});
