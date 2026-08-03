import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song, SourceKey } from '@mplayer/core';
import { searchSwapCandidates, applySwap } from '../services/sourceSwap';

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

function qqSong(id: string, name: string, artist = '周杰伦'): Song {
  return { id, name, artist, album: '', duration: 240, sourceType: 'qq', url: 'https://audio.qq.com/full.mp3', cover: '', lrc: '' };
}

beforeEach(() => {
  musicApiMock.searchSongs.mockReset();
  musicApiMock.searchSongs.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('searchSwapCandidates', () => {
  it('ranks exact matches first, then by similarity, capped at 3', async () => {
    musicApiMock.searchSongs.mockImplementation(async (kw: string, _page: number, source: SourceKey) => {
      if (source !== 'qq') return [];
      return [
        qqSong('live', '晴天 (Live)'),
        qqSong('cover', '晴天', '翻唱者'),
        qqSong('orig', '晴天'),
        qqSong('remix', '晴天 (Remix)'),
      ];
    });

    const candidates = await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq');

    expect(candidates.length).toBe(3); // 上限 3
    expect(candidates[0].exact).toBe(true); // 精确匹配排最前
    expect(candidates[0].song.id).toBe('orig');
    expect(musicApiMock.searchSongs).toHaveBeenCalledWith('晴天 周杰伦', 1, 'qq');
  });

  it('returns empty when the source returns nothing', async () => {
    musicApiMock.searchSongs.mockResolvedValue([]);
    expect(await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq')).toEqual([]);
  });

  it('returns empty for a song already on the target source', async () => {
    expect(await searchSwapCandidates(qqSong('q1', '晴天'), 'qq')).toEqual([]);
    expect(musicApiMock.searchSongs).not.toHaveBeenCalled();
  });
});

describe('applySwap', () => {
  it('builds the swapped song with single-layer source prefix', async () => {
    const candidates = await (async () => {
      musicApiMock.searchSongs.mockResolvedValue([qqSong('orig', '晴天')]);
      return searchSwapCandidates(neteaseSong('1', '晴天'), 'qq');
    })();

    const swapped = applySwap(neteaseSong('1', '晴天'), 'qq', candidates[0]);

    expect(swapped).not.toBeNull();
    expect(swapped!.sourceType).toBe('qq');
    expect(swapped!.url).toContain('audio.qq.com');
    expect(swapped!.name).toBe('晴天');
    expect(swapped!.artist).toBe('周杰伦');
  });

  it('strips repeated source prefixes and keeps the target source real id', async () => {
    // 换源后的歌（kugou:1）再换到 kuwo：id 用目标源真实曲目 ID + 单层前缀
    const kugouSong: Song = { ...qqSong('k1', '晴天'), id: 'kugou:1', sourceType: 'kugou' };
    const candidates = await (async () => {
      musicApiMock.searchSongs.mockResolvedValue([{ ...qqSong('k1', '晴天'), sourceType: 'kuwo' }]);
      return searchSwapCandidates(kugouSong, 'kuwo');
    })();

    const swapped = applySwap(kugouSong, 'kuwo', candidates[0]);

    expect(swapped!.id).toBe('kuwo:k1'); // 目标源真实 id（k1），不是嵌套的 kuwo:kugou:1
  });
});
