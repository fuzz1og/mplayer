import { describe, it, expect, vi } from 'vitest';
import { resolvePlayableUrl } from '../shared';
import type { Song } from '@mplayer/core';

const baseSong: Song = {
  id: '1', name: '晴天', artist: '周杰伦', album: '叶惠美',
  duration: 240, sourceType: 'netease', url: '', cover: '', lrc: '',
};

describe('resolvePlayableUrl', () => {
  it('returns url directly if already valid', async () => {
    const song = { ...baseSong, url: 'https://example.com/audio.mp3' };
    const resolver = { searchSongs: vi.fn(), getSodaAudioUrl: vi.fn(), getAudioUrl: vi.fn() };

    const url = await resolvePlayableUrl(song, resolver);
    expect(url).toBe('https://example.com/audio.mp3');
    expect(resolver.searchSongs).not.toHaveBeenCalled();
  });

  it('searches when url is missing', async () => {
    const song = { ...baseSong, url: '' };
    const resolver = {
      searchSongs: vi.fn().mockResolvedValue([{ ...baseSong, url: 'https://found.mp3' }]),
      getSodaAudioUrl: vi.fn(),
      getAudioUrl: vi.fn(),
    };

    const url = await resolvePlayableUrl(song, resolver);
    expect(url).toBe('https://found.mp3');
    expect(resolver.searchSongs).toHaveBeenCalledWith('晴天 周杰伦', 1, 'netease');
  });

  it('uses getSodaAudioUrl for soda source', async () => {
    const song = { ...baseSong, sourceType: 'soda' as const, url: '', id: 'soda123' };
    const resolver = {
      searchSongs: vi.fn().mockResolvedValue([]),
      getSodaAudioUrl: vi.fn().mockResolvedValue('https://soda.audio.mp3'),
      getAudioUrl: vi.fn(),
    };

    const url = await resolvePlayableUrl(song, resolver);
    expect(url).toBe('https://soda.audio.mp3');
  });

  it('falls back to getAudioUrl', async () => {
    const song = { ...baseSong, url: 'invalid-url' };
    const resolver = {
      searchSongs: vi.fn().mockResolvedValue([]),
      getSodaAudioUrl: vi.fn(),
      getAudioUrl: vi.fn().mockResolvedValue('https://resolved.mp3'),
    };

    const url = await resolvePlayableUrl(song, resolver);
    expect(url).toBe('https://resolved.mp3');
  });

  it('throws when no playable url', async () => {
    const song = { ...baseSong, url: '', name: '' };
    const resolver = {
      searchSongs: vi.fn().mockResolvedValue([]),
      getSodaAudioUrl: vi.fn().mockResolvedValue(''),
      getAudioUrl: vi.fn().mockResolvedValue(''),
    };

    await expect(resolvePlayableUrl(song, resolver)).rejects.toThrow('no playable URL');
  });
});