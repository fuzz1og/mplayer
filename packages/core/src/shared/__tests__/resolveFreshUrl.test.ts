import { describe, expect, it, vi } from 'vitest';
import { resolveFreshUrl } from '../resolveFreshUrl.js';
import type { FreshUrlResolver } from '../resolveFreshUrl.js';
import type { Song } from '../../types/index.js';

function song(id: string, url = '', sourceType: Song['sourceType'] = 'netease'): Song {
  return { id, name: `song-${id}`, artist: 'a', album: '', duration: 100, sourceType, url, cover: '', lrc: '' };
}

function resolver(overrides: Partial<FreshUrlResolver> = {}): FreshUrlResolver {
  return {
    getSodaAudioUrl: vi.fn(async () => ''),
    getAudioUrl: vi.fn(async (u: string) => u),
    searchSongs: vi.fn(async () => []),
    clearAudioUrlCache: vi.fn(),
    ...overrides,
  };
}

describe('resolveFreshUrl', () => {
  it('uses the soda direct URL for soda songs', async () => {
    const r = resolver({ getSodaAudioUrl: vi.fn(async () => 'https://soda.example.com/1.mp3') });
    await expect(resolveFreshUrl(song('1', '', 'soda'), r)).resolves.toBe('https://soda.example.com/1.mp3');
    expect(r.getSodaAudioUrl).toHaveBeenCalledWith('1');
  });

  it('clears the audio URL cache before resolving', async () => {
    const r = resolver({ getSodaAudioUrl: vi.fn(async () => 'https://soda.example.com/1.mp3') });
    await resolveFreshUrl(song('1', '', 'soda'), r);
    expect(r.clearAudioUrlCache).toHaveBeenCalledOnce();
  });

  it('follows redirects and rejects URLs that resolve unchanged', async () => {
    const r = resolver({
      getAudioUrl: vi.fn(async (u: string) => (u === 'https://stale.example.com/1.mp3' ? 'https://fresh.example.com/1.mp3' : u)),
    });
    await expect(resolveFreshUrl(song('1', 'https://stale.example.com/1.mp3'), r))
      .resolves.toBe('https://fresh.example.com/1.mp3');
  });

  it('falls back to re-search when the redirect is unchanged', async () => {
    const r = resolver({
      getAudioUrl: vi.fn(async (u: string) => u), // 结果不变 = 源 URL 失效
      searchSongs: vi.fn(async () => [song('1', 'https://searched.example.com/1.mp3')]),
    });
    await expect(resolveFreshUrl(song('1', 'https://same.example.com/1.mp3'), r))
      .resolves.toBe('https://searched.example.com/1.mp3');
    expect(r.searchSongs).toHaveBeenCalledWith('song-1 a', 1, 'netease');
  });

  it('throws when every strategy fails', async () => {
    await expect(resolveFreshUrl(song('1'), resolver())).rejects.toThrow('fresh URL resolve failed');
  });
});
