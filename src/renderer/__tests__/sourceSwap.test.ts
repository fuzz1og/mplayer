import { describe, expect, it, vi } from 'vitest';
import type { Song, SourceKey } from '@mplayer/core';
import { searchSwapCandidates, applySwap, type SwapCandidate, type SourceSwapDeps } from '@/renderer/services/sourceSwap';

function neteaseSong(id: string, name: string): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url: 'https://audio.example.com/preview.mp3', cover: '', lrc: '' };
}

function qqSong(id: string, name: string, artist = '周杰伦'): Song {
  return { id, name, artist, album: '', duration: 240, sourceType: 'qq', url: 'https://audio.qq.com/full.mp3', cover: '', lrc: '' };
}

function makeDeps(): SourceSwapDeps {
  return { searchSongs: vi.fn(async () => []) };
}

describe('searchSwapCandidates', () => {
  it('ranks exact matches first, then by similarity, capped at 3', async () => {
    const deps = makeDeps();
    deps.searchSongs = vi.fn(async (kw: string, _page: number, source: SourceKey) => {
      if (source !== 'qq') return [];
      return [
        qqSong('live', '晴天 (Live)'),
        qqSong('cover', '晴天', '翻唱者'),
        qqSong('orig', '晴天'),
        qqSong('remix', '晴天 (Remix)'),
      ];
    });

    const candidates = await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq', deps);

    expect(candidates.length).toBe(3); // 上限 3
    expect(candidates[0].exact).toBe(true); // 精确匹配排最前
    expect(candidates[0].song.id).toBe('orig');
    expect(deps.searchSongs).toHaveBeenCalledWith('晴天 周杰伦', 1, 'qq');
  });

  it('returns empty when the source returns nothing', async () => {
    const deps = makeDeps();
    expect(await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq', deps)).toEqual([]);
  });

  it('returns empty for a song already on the target source', async () => {
    const deps = makeDeps();
    expect(await searchSwapCandidates(qqSong('q1', '晴天'), 'qq', deps)).toEqual([]);
    expect(deps.searchSongs).not.toHaveBeenCalled();
  });
});

describe('URL-ID 错位检查（零请求，#391 保留）', () => {
  it('searchSwapCandidates 直接标错位候选失效，不再有任何探测依赖', async () => {
    const deps = makeDeps();
    deps.searchSongs = vi.fn(async () => [
      { ...qqSong('123', '晴天'), url: 'https://api.example.com/302?get=url&id=999' },
    ]);

    const candidates = await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq', deps);

    expect(candidates[0].playable).toBe(false);
    expect(candidates[0].tag).toBe('invalid');
  });
});

describe('applySwap', () => {
  it('builds the swapped song with single-layer source prefix', () => {
    const candidate: SwapCandidate = {
      song: qqSong('orig', '晴天'),
      exact: true,
      score: 1,
      playable: null,
      tag: null,
    };

    const swapped = applySwap(neteaseSong('1', '晴天'), 'qq', candidate);

    expect(swapped).not.toBeNull();
    expect(swapped!.sourceType).toBe('qq');
    expect(swapped!.url).toContain('audio.qq.com');
    expect(swapped!.name).toBe('晴天');
    expect(swapped!.artist).toBe('周杰伦');
  });

  it('strips repeated source prefixes and keeps the target source real id', () => {
    const kugouSong: Song = { ...qqSong('k1', '晴天'), id: 'kugou:1', sourceType: 'kugou' };
    const candidate: SwapCandidate = {
      song: { ...qqSong('k1', '晴天'), sourceType: 'kuwo' },
      exact: true,
      score: 1,
      playable: null,
      tag: null,
    };

    const swapped = applySwap(kugouSong, 'kuwo', candidate);

    expect(swapped!.id).toBe('kuwo:k1'); // 目标源真实 id（k1），不是嵌套的 kuwo:kugou:1
  });

  it('rejects a candidate without its own id', () => {
    const candidate: SwapCandidate = {
      song: { ...qqSong('q1', '晴天'), id: '' },
      exact: false,
      score: 0.5,
      playable: null,
      tag: null,
    };

    expect(applySwap(neteaseSong('1', '晴天'), 'qq', candidate)).toBeNull();
  });
});
