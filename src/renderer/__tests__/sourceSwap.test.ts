import { describe, expect, it, vi } from 'vitest';
import type { Song, SourceKey, AudioTag } from '@mplayer/core';
import { searchSwapCandidates, applySwap, probeSwapCandidates, type SwapCandidate, type SourceSwapDeps } from '@/renderer/services/sourceSwap';

function neteaseSong(id: string, name: string): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url: 'https://audio.example.com/preview.mp3', cover: '', lrc: '' };
}

function qqSong(id: string, name: string, artist = '周杰伦'): Song {
  return { id, name, artist, album: '', duration: 240, sourceType: 'qq', url: 'https://audio.qq.com/full.mp3', cover: '', lrc: '' };
}

function makeDeps(): SourceSwapDeps {
  return {
    searchSongs: vi.fn(async () => []),
    probeSongs: vi.fn(async () => []),
  };
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

describe('probeSwapCandidates', () => {
  it('probes url-less candidates instead of pre-marking invalid (routed-era semantics)', async () => {
    const deps = makeDeps();
    deps.probeSongs = vi.fn(async () => [{ songId: 'q1', tag: 'valid' as AudioTag }]);
    const candidates: SwapCandidate[] = [
      { song: { ...qqSong('q1', '晴天'), url: '' }, exact: true, score: 1, playable: null, tag: null },
    ];

    const probed = await probeSwapCandidates(candidates, deps);

    // 路由时代候选天生无 url：送探测器自解析（并写预取缓存），不再预标失效
    expect(deps.probeSongs).toHaveBeenCalledWith([candidates[0].song]);
    expect(probed[0].playable).toBe(true);
    expect(probed[0].tag).toBe('valid');
  });

  it('applies probe tags to matching candidates by song id', async () => {
    const deps = makeDeps();
    deps.probeSongs = vi.fn(async () => [
      { songId: 'q1', tag: 'preview' as AudioTag },
      { songId: 'q2', tag: 'valid' as AudioTag },
    ]);
    const candidates: SwapCandidate[] = [
      { song: qqSong('q1', '晴天'), exact: true, score: 1, playable: null, tag: null },
      { song: qqSong('q2', '晴天 (Live)'), exact: false, score: 0.5, playable: null, tag: null },
    ];

    const probed = await probeSwapCandidates(candidates, deps);

    expect(probed.find(c => c.song.id === 'q1')?.tag).toBe('preview');
    expect(probed.find(c => c.song.id === 'q1')?.playable).toBe(true);
    expect(probed.find(c => c.song.id === 'q2')?.tag).toBe('valid');
    expect(deps.probeSongs).toHaveBeenCalledWith([qqSong('q1', '晴天'), qqSong('q2', '晴天 (Live)')]);
  });
});

describe('applySwap', () => {
  it('builds the swapped song with single-layer source prefix', () => {
    const candidate: SwapCandidate = {
      song: qqSong('orig', '晴天'),
      exact: true,
      score: 1,
      playable: true,
      tag: 'valid',
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
      playable: true,
      tag: 'valid',
    };

    const swapped = applySwap(kugouSong, 'kuwo', candidate);

    expect(swapped!.id).toBe('kuwo:k1'); // 目标源真实 id（k1），不是嵌套的 kuwo:kugou:1
  });

  it('rejects a candidate without its own id', () => {
    const candidate: SwapCandidate = {
      song: { ...qqSong('q1', '晴天'), id: '' },
      exact: false,
      score: 0.5,
      playable: true,
      tag: 'valid',
    };

    expect(applySwap(neteaseSong('1', '晴天'), 'qq', candidate)).toBeNull();
  });
});
