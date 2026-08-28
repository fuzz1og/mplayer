import { describe, expect, it, vi } from 'vitest';
import { parsePlaylistUrl, importFromLink } from '../playlistImport.js';
import type { PlaylistImportDeps } from '../playlistImport.js';
import type { Song } from '../../types/index.js';

function song(id: string, name: string, artist = 'a'): Song {
  return { id, name, artist, album: '', duration: 100, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

function deps(overrides: Partial<PlaylistImportDeps> = {}): PlaylistImportDeps {
  return {
    addSong: vi.fn(async () => {}),
    ...overrides,
  };
}

const progress = vi.fn();

describe('parsePlaylistUrl', () => {
  it('recognizes full netease playlist URLs', () => {
    expect(parsePlaylistUrl('https://music.163.com/#/playlist?id=123456')).toEqual({ type: 'netease', id: '123456' });
    expect(parsePlaylistUrl('https://music.163.com/playlist?id=123456')).toEqual({ type: 'netease', id: '123456' });
  });

  it('recognizes netease short links', () => {
    expect(parsePlaylistUrl('https://163cn.tv/abc123')).toEqual({ type: 'netease-short', url: 'https://163cn.tv/abc123' });
  });

  it('recognizes qq music links', () => {
    const qq = parsePlaylistUrl('https://c6.y.qq.com/base/fcgi-bin/u?__=xyz');
    expect(qq?.type).toBe('qq');
    expect(qq?.url).toContain('c6.y.qq.com');
  });

  it('returns null for unknown input', () => {
    expect(parsePlaylistUrl('')).toBeNull();
    expect(parsePlaylistUrl('https://example.com/foo')).toBeNull();
  });
});

describe('importFromLink', () => {
  it('imports only selected songs, skipping duplicates', async () => {
    const songs = [song('1', 'A'), song('2', 'B'), song('3', 'C')];
    const d = deps();
    const result = await importFromLink(5, songs, new Set(['1', '2']), [song('2', 'B')], d, progress);
    expect(result.successes).toHaveLength(1);
    expect(result.successes[0].song.id).toBe('1');
    expect(result.skips).toHaveLength(1);
    expect(d.addSong).toHaveBeenCalledTimes(1);
  });
});
