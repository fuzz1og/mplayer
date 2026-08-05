import { describe, expect, it, vi } from 'vitest';
import { searchSwapCandidates, probeSwapCandidates, applySwap } from '../sourceSwap.js';
import type { SwapCandidate, SourceSwapDeps } from '../sourceSwap.js';
import type { Song, SourceKey, AudioTag } from '../../types/index.js';

function neteaseSong(id: string, name: string): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url: 'https://audio.example.com/preview.mp3', cover: '', lrc: '' };
}

function qqSong(id: string, name: string, artist = '周杰伦'): Song {
  return { id, name, artist, album: '', duration: 240, sourceType: 'qq', url: 'https://audio.qq.com/full.mp3', cover: '', lrc: '' };
}

function makeDeps(overrides: Partial<SourceSwapDeps> = {}): SourceSwapDeps {
  return {
    searchSongs: vi.fn(async () => []),
    probeSongs: vi.fn(async () => []),
    ...overrides,
  };
}

describe('searchSwapCandidates', () => {
  it('ranks exact matches first, then by similarity, capped at 3', async () => {
    const deps = makeDeps({
      searchSongs: vi.fn(async (_kw: string, _page: number, source: SourceKey) => {
        if (source !== 'qq') return [];
        return [
          qqSong('live', '晴天 (Live)'),
          qqSong('cover', '晴天', '翻唱者'),
          qqSong('orig', '晴天'),
          qqSong('remix', '晴天 (Remix)'),
        ];
      }),
    });

    const candidates = await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq', deps);

    expect(candidates.length).toBe(3);
    expect(candidates[0].exact).toBe(true);
    expect(candidates[0].song.id).toBe('orig');
    expect(deps.searchSongs).toHaveBeenCalledWith('晴天 周杰伦', 1, 'qq');
  });

  it('returns empty for the current source without searching', async () => {
    const deps = makeDeps();
    expect(await searchSwapCandidates(qqSong('q1', '晴天'), 'qq', deps)).toEqual([]);
    expect(deps.searchSongs).not.toHaveBeenCalled();
  });

  it('reports empty results and search failures through the log hook', async () => {
    const log = vi.fn();
    const empty = makeDeps({ log });
    await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq', empty);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('换源候选为空'));

    const failing = makeDeps({ searchSongs: vi.fn(async () => { throw new Error('boom'); }), log });
    await expect(searchSwapCandidates(neteaseSong('1', '晴天'), 'qq', failing)).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('换源搜索失败'));
  });
});

describe('probeSwapCandidates', () => {
  it('marks songs without url invalid without probing', async () => {
    const deps = makeDeps();
    const candidates: SwapCandidate[] = [
      { song: { ...qqSong('q1', '晴天'), url: '' }, exact: true, score: 1, playable: null, tag: null },
    ];

    const probed = await probeSwapCandidates(candidates, deps);

    expect(probed[0].playable).toBe(false);
    expect(probed[0].tag).toBe('invalid');
    expect(deps.probeSongs).not.toHaveBeenCalled();
  });

  it('marks url-id mismatched candidates invalid (source data offset)', async () => {
    const deps = makeDeps();
    const candidates: SwapCandidate[] = [
      { song: qqSong('123', '晴天'), exact: true, score: 1, playable: null, tag: null },
    ];
    candidates[0].song.url = 'https://api.example.com/302?get=url&id=999';

    const probed = await probeSwapCandidates(candidates, deps);

    expect(probed[0].song.id).toBe('123');
    expect(probed[0].playable).toBe(false);
    expect(probed[0].tag).toBe('invalid');
    expect(deps.probeSongs).not.toHaveBeenCalled();
  });

  it('applies probe tags to matching candidates by song id', async () => {
    const deps = makeDeps({
      probeSongs: vi.fn(async () => [
        { songId: 'q1', tag: 'preview' as AudioTag },
        { songId: 'q2', tag: 'valid' as AudioTag },
      ]),
    });
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

  it('keeps candidates unlabelled when probing fails', async () => {
    const deps = makeDeps({ probeSongs: vi.fn(async () => { throw new Error('probe down'); }) });
    const candidates: SwapCandidate[] = [
      { song: qqSong('q1', '晴天'), exact: true, score: 1, playable: null, tag: null },
    ];

    const probed = await probeSwapCandidates(candidates, deps);

    expect(probed[0].playable).toBeNull();
    expect(probed[0].tag).toBeNull();
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

    expect(swapped!.id).toBe('kuwo:k1');
  });

  it('rejects candidates without url or id', () => {
    const noUrl: SwapCandidate = {
      song: { ...qqSong('q1', '晴天'), url: '' },
      exact: true, score: 1, playable: true, tag: 'valid',
    };
    expect(applySwap(neteaseSong('1', '晴天'), 'qq', noUrl)).toBeNull();

    const noId: SwapCandidate = {
      song: { ...qqSong('q1', '晴天'), id: '' },
      exact: false, score: 0.5, playable: true, tag: 'valid',
    };
    expect(applySwap(neteaseSong('1', '晴天'), 'qq', noId)).toBeNull();
  });
});
