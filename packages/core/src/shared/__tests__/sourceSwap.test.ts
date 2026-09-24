import { describe, expect, it, vi } from 'vitest';
import { searchSwapCandidates, applySwap } from '../sourceSwap.js';
import type { SwapCandidate, SourceSwapDeps } from '../sourceSwap.js';
import type { Song, SourceKey } from '../../types/index.js';

function neteaseSong(id: string, name: string): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url: 'https://audio.example.com/preview.mp3', cover: '', lrc: '' };
}

function qqSong(id: string, name: string, artist = '周杰伦'): Song {
  return { id, name, artist, album: '', duration: 240, sourceType: 'qq', url: 'https://audio.qq.com/full.mp3', cover: '', lrc: '' };
}

function makeDeps(overrides: Partial<SourceSwapDeps> = {}): SourceSwapDeps {
  return {
    searchSongs: vi.fn(async () => []),
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

  it('marks URL-ID 错位候选 invalid（零请求检查，源数据错位）', async () => {
    const log = vi.fn();
    const deps = makeDeps({
      log,
      searchSongs: vi.fn(async () => [
        { ...qqSong('123', '晴天'), url: 'https://api.example.com/302?get=url&id=999' },
        { ...qqSong('124', '晴天'), url: 'https://api.example.com/302?get=url&id=124' },
      ]),
    });

    const candidates = await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq', deps);

    // 错位候选被直接剔除，只剩 id 一致的那条（零请求）
    expect(candidates.map((c) => c.song.id)).toEqual(['124']);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('链接 ID 与歌曲不符'));
  });

  it('无 url 候选不做错位检查、原样保留（#391 后不再有任何探测）', async () => {
    const deps = makeDeps({
      searchSongs: vi.fn(async () => [{ ...qqSong('q1', '晴天'), url: '' }]),
    });

    const candidates = await searchSwapCandidates(neteaseSong('1', '晴天'), 'qq', deps);

    expect(candidates.map((c) => c.song.id)).toEqual(['q1']);
  });
});

describe('applySwap', () => {
  it('builds the swapped song with single-layer source prefix', () => {
    const candidate: SwapCandidate = {
      song: qqSong('orig', '晴天'),
      exact: true,
      score: 1,
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
    };

    const swapped = applySwap(kugouSong, 'kuwo', candidate);

    expect(swapped!.id).toBe('kuwo:k1');
  });

  it('migu 候选带前缀 id 不再写成 migu:migu:1（#307 前缀表补齐）', () => {
    const candidate: SwapCandidate = {
      song: { ...qqSong('m1', '晴天'), id: 'migu:1', sourceType: 'migu' },
      exact: true,
      score: 1,
    };

    const swapped = applySwap(neteaseSong('1', '晴天'), 'migu', candidate);

    expect(swapped!.sourceType).toBe('migu');
    expect(swapped!.id).toBe('migu:1');
  });

  it('rejects candidates without id; allows url-less candidates (resolved at play)', () => {
    const noId: SwapCandidate = {
      song: { ...qqSong('q1', '晴天'), id: '' },
      exact: false, score: 0.5,
    };
    expect(applySwap(neteaseSong('1', '晴天'), 'qq', noId)).toBeNull();

    // 无 url 候选可换：播放时 resolvePlayableSongRouted 现解析（预取缓存由门面写入）
    const urlLess: SwapCandidate = {
      song: { ...qqSong('q1', '晴天'), url: '' },
      exact: true, score: 1,
    };
    const swapped = applySwap(neteaseSong('1', '晴天'), 'qq', urlLess);
    expect(swapped).not.toBeNull();
    expect(swapped!.id).toBe('qq:q1');
    expect(swapped!.url).toBe('');
  });
});
