import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song, SourceKey } from '@mplayer/core';
import { swapSongToSource } from '../services/sourceSwap';

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

describe('swapSongToSource', () => {
  it('returns the matched full version from the target source', async () => {
    musicApiMock.searchSongs.mockImplementation(async (kw: string, _page: number, source: SourceKey) => {
      if (source !== 'qq') return [];
      return [qqSong(`qq-${kw}`, '晴天')];
    });

    const swapped = await swapSongToSource(neteaseSong('1', '晴天'), 'qq');

    expect(swapped).not.toBeNull();
    expect(swapped!.sourceType).toBe('qq');
    expect(swapped!.url).toContain('audio.qq.com');
    expect(swapped!.id).toBe('qq:1'); // 保留原 id 前缀避免冲突
    expect(swapped!.name).toBe('晴天');
    expect(musicApiMock.searchSongs).toHaveBeenCalledWith('晴天 周杰伦', 1, 'qq');
  });

  it('returns null when no match is found', async () => {
    musicApiMock.searchSongs.mockResolvedValue([]);
    expect(await swapSongToSource(neteaseSong('1', '晴天'), 'qq')).toBeNull();
  });

  it('returns null for a song already on the target source', async () => {
    expect(await swapSongToSource(qqSong('q1', '晴天'), 'qq')).toBeNull();
    expect(musicApiMock.searchSongs).not.toHaveBeenCalled();
  });
});
