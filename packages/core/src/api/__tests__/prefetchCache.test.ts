import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import {
  clearPrefetchCache,
  getPrefetchedUrl,
  PREFETCH_TTL_MS,
  rememberProbeResult,
  setPrefetchedUrl,
} from '../prefetchCache.js';

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: '1',
    name: '晴天',
    artist: '周杰伦',
    album: '',
    url: '',
    cover: '',
    lrc: '',
    duration: 240,
    sourceType: 'netease',
    ...overrides,
  };
}

beforeEach(() => {
  clearPrefetchCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('prefetchCache（预取 URL 缓存）', () => {
  it('写入后立即按同歌取回 url 与 nonFull', () => {
    setPrefetchedUrl(song(), 'https://cdn.example.com/a.mp3', true);

    expect(getPrefetchedUrl(song())).toEqual({
      url: 'https://cdn.example.com/a.mp3',
      nonFull: true,
    });
  });

  it('超过 TTL 后视为未命中', () => {
    vi.useFakeTimers();
    setPrefetchedUrl(song(), 'https://cdn.example.com/a.mp3', false);

    vi.advanceTimersByTime(PREFETCH_TTL_MS + 1);

    expect(getPrefetchedUrl(song())).toBeUndefined();
  });

  it('同 id 不同源互不串键（netease:1 与 qq:1 是两首歌）', () => {
    setPrefetchedUrl(song({ sourceType: 'netease' }), 'https://netease.example.com/1.mp3', false);

    expect(getPrefetchedUrl(song({ sourceType: 'qq' }))).toBeUndefined();
    expect(getPrefetchedUrl(song({ sourceType: 'netease' }))?.url).toBe(
      'https://netease.example.com/1.mp3',
    );
  });

  it('rememberProbeResult：invalid 不缓存（直连死链不能进预取）', () => {
    rememberProbeResult(song(), 'https://cdn.example.com/dead.mp3', 'invalid');

    expect(getPrefetchedUrl(song())).toBeUndefined();
  });

  it('rememberProbeResult：空 URL 不缓存', () => {
    rememberProbeResult(song(), '', 'valid');
    rememberProbeResult(song(), 'not-a-url', 'valid');

    expect(getPrefetchedUrl(song())).toBeUndefined();
  });

  it('rememberProbeResult：preview 标 nonFull，valid 不标', () => {
    rememberProbeResult(song(), 'https://cdn.example.com/trial.mp3', 'preview');
    expect(getPrefetchedUrl(song())?.nonFull).toBe(true);

    clearPrefetchCache();
    rememberProbeResult(song(), 'https://cdn.example.com/full.mp3', 'valid');
    expect(getPrefetchedUrl(song())?.nonFull).toBe(false);
  });

  it('rememberProbeResult：直连权威判定 nonFull（如 UrlInfo 短时长）也能保留', () => {
    rememberProbeResult(song(), 'https://cdn.example.com/trial.mp3', 'valid', true);

    expect(getPrefetchedUrl(song())?.nonFull).toBe(true);
  });
});
