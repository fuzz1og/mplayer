import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// pure module, no mocks needed
import { cacheManager } from '../../main/api/memoryCacheManager';

describe('memoryCacheManager', () => {
  beforeEach(() => {
    cacheManager.clearAll();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('get returns null for missing key', () => {
    expect(cacheManager.get('nonexistent')).toBeNull();
  });

  it('get returns null for expired key', () => {
    cacheManager.set('key1', 'value1', 1000); // 1s TTL
    expect(cacheManager.get('key1')).toBe('value1');

    vi.advanceTimersByTime(1001);
    expect(cacheManager.get('key1')).toBeNull();
  });

  it('set and get roundtrip', () => {
    cacheManager.set('key1', { foo: 'bar' }, 60000);
    expect(cacheManager.get('key1')).toEqual({ foo: 'bar' });
  });

  it('set rejects null', () => {
    cacheManager.set('nullkey', null, 60000);
    expect(cacheManager.get('nullkey')).toBeNull();
  });

  it('set rejects undefined', () => {
    cacheManager.set('undefinedkey', undefined, 60000);
    expect(cacheManager.get('undefinedkey')).toBeNull();
  });

  it('set rejects empty array', () => {
    cacheManager.set('emptyarr', [], 60000);
    expect(cacheManager.get('emptyarr')).toBeNull();
  });

  it('set rejects empty string', () => {
    cacheManager.set('emptystr', '', 60000);
    expect(cacheManager.get('emptystr')).toBeNull();
  });

  it('set allows whitespace string', () => {
    cacheManager.set('whitestr', '   ', 60000);
    expect(cacheManager.get('whitestr')).toBeNull();
  });

  it('clearByPrefix removes matching keys only', () => {
    cacheManager.set('search:foo', 'result1', 60000);
    cacheManager.set('search:bar', 'result2', 60000);
    cacheManager.set('hotlist:top', 'result3', 60000);

    cacheManager.clearByPrefix('search:');

    expect(cacheManager.get('search:foo')).toBeNull();
    expect(cacheManager.get('search:bar')).toBeNull();
    expect(cacheManager.get('hotlist:top')).toBe('result3');
  });

  it('clearAll removes all keys', () => {
    cacheManager.set('a', 1, 60000);
    cacheManager.set('b', 2, 60000);
    cacheManager.clearAll();

    expect(cacheManager.get('a')).toBeNull();
    expect(cacheManager.get('b')).toBeNull();
  });

  describe('specialized caches', () => {
    it('search cache roundtrip', () => {
      const songs = [{ id: '1', name: 'test' }] as any[];
      cacheManager.setSearchCache('keyword', 1, 'netease', songs);
      const result = cacheManager.getSearchCache('keyword', 1, 'netease');
      expect(result).toEqual(songs);
    });

    it('search cache misses on different params', () => {
      cacheManager.setSearchCache('keyword', 1, 'netease', [{ id: '1' }] as any[]);
      expect(cacheManager.getSearchCache('keyword', 2, 'netease')).toBeNull();
    });

    it('hotlist cache roundtrip', () => {
      const data = [{ rank: 1 }];
      cacheManager.setHotlistCache('netease', data);
      expect(cacheManager.getHotlistCache('netease')).toEqual(data);
    });

    it('audio URL cache roundtrip', () => {
      cacheManager.setAudioUrlCache('old-url', 'new-url');
      expect(cacheManager.getAudioUrlCache('old-url')).toBe('new-url');
    });

    it('lyrics cache roundtrip', () => {
      cacheManager.setLyricsCache('lrc-url', 'lyrics text');
      expect(cacheManager.getLyricsCache('lrc-url')).toBe('lyrics text');
    });

    it('batch search cache roundtrip', () => {
      const data = { keyword1: [{ id: '1' }] as any[] };
      cacheManager.setBatchSearchCache(['keyword1', 'keyword2'], 'netease', data);
      const result = cacheManager.getBatchSearchCache(['keyword2', 'keyword1'], 'netease');
      expect(result).toEqual(data);
    });

    it('playlist list cache roundtrip', () => {
      const data = { playlists: [] };
      cacheManager.setPlaylistListCache('全部', 'hot', 0, 30, data);
      expect(cacheManager.getPlaylistListCache('全部', 'hot', 0, 30)).toEqual(data);
    });

    it('playlist detail cache roundtrip', () => {
      const data = { id: 123, name: 'test' };
      cacheManager.setPlaylistDetailCache(123, data);
      expect(cacheManager.getPlaylistDetailCache(123)).toEqual(data);
    });
  });
});
