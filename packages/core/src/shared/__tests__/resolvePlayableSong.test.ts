import { describe, expect, it, vi } from 'vitest';
import { resolvePlayableSong } from '../resolvePlayableUrl.js';
import type { UrlResolver } from '../resolvePlayableUrl.js';
import type { Song } from '../../types/index.js';

function song(id: string, url = '', lrc = '', sourceType: Song['sourceType'] = 'netease'): Song {
  return { id, name: `song-${id}`, artist: 'a', album: '', duration: 100, sourceType, url, lrc, cover: '' };
}

function resolver(overrides: Partial<UrlResolver> = {}): UrlResolver {
  return {
    searchSongs: vi.fn(async () => []),
    getSodaAudioUrl: vi.fn(async () => ''),
    getAudioUrl: vi.fn(async (u: string) => u),
    ...overrides,
  };
}

describe('resolvePlayableSong', () => {
  it('returns url and lrc together from the fetch endpoint when lrc is missing', async () => {
    // 今日推荐/歌单的歌：有 url 无 lrc → 搜索一次,同时拿回歌词地址
    const s = song('1', 'https://audio.example.com/1.mp3');
    const r = resolver({
      searchSongs: vi.fn(async () => [
        song('1', 'https://audio.example.com/1.mp3', 'api.php?get=lrc&type=wy&id=1'),
      ]),
    });

    const result = await resolvePlayableSong(s, r);

    expect(r.searchSongs).toHaveBeenCalledWith('song-1 a', 1, 'netease');
    expect(result.url).toBe('https://audio.example.com/1.mp3');
    expect(result.lrc).toBe('api.php?get=lrc&type=wy&id=1');
  });

  it('fills url and lrc together when both are missing', async () => {
    const s = song('1');
    const r = resolver({
      searchSongs: vi.fn(async () => [
        song('1', 'https://audio.example.com/1.mp3', 'https://lrc.example.com/1.lrc'),
      ]),
    });

    const result = await resolvePlayableSong(s, r);

    expect(result.url).toBe('https://audio.example.com/1.mp3');
    expect(result.lrc).toBe('https://lrc.example.com/1.lrc');
  });

  it('does not search when url and lrc are already present', async () => {
    const s = song('1', 'https://audio.example.com/1.mp3', 'https://lrc.example.com/1.lrc');
    const r = resolver();

    const result = await resolvePlayableSong(s, r);

    expect(r.searchSongs).not.toHaveBeenCalled();
    expect(result.url).toBe('https://audio.example.com/1.mp3');
    expect(result.lrc).toBe('https://lrc.example.com/1.lrc');
  });

  it('works for non-netease sources (qq/kugou) through the fetch endpoint', async () => {
    const s = song('q1', '', '', 'qq');
    const r = resolver({
      searchSongs: vi.fn(async () => [
        song('q1', 'https://audio.qq.com/q1.mp3', 'api.php?get=lrc&type=qq&id=q1'),
      ]),
    });

    const result = await resolvePlayableSong(s, r);

    expect(r.searchSongs).toHaveBeenCalledWith('song-q1 a', 1, 'qq');
    expect(result.url).toContain('audio.qq.com');
    expect(result.lrc).toContain('type=qq');
  });

  it('uses local files directly without searching', async () => {
    const s = song('l1', 'file:///data/local.mp3', '', 'local');
    const r = resolver();

    const result = await resolvePlayableSong(s, r);

    expect(r.searchSongs).not.toHaveBeenCalled();
    expect(result.url).toBe('file:///data/local.mp3');
    expect(result.lrc).toBe('');
  });
});
