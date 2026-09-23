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

  it('recognizes qq web playlist direct links with id（#280）', () => {
    expect(parsePlaylistUrl('https://y.qq.com/n/ryqq/playlist/7729596131')).toEqual({ type: 'qq', id: '7729596131' });
    expect(parsePlaylistUrl('https://y.qq.com/n/ryqq_v2/playlist/7729596131')).toEqual({ type: 'qq', id: '7729596131' });
  });

  it('recognizes qq ryqq_v2 direct links carrying share query params（#383）', () => {
    expect(
      parsePlaylistUrl(
        'https://y.qq.com/n/ryqq_v2/playlist/8934447082?ADTAG=h5_share_playlist&redirecttag=mn.redirect.custom&mnst=0.98',
      ),
    ).toEqual({ type: 'qq', id: '8934447082' });
  });

  it('recognizes qq h5 share pages with id（#280）', () => {
    expect(parsePlaylistUrl('https://i.y.qq.com/n2/m/share/details/taoge.html?id=5204875759')).toEqual({
      type: 'qq',
      id: '5204875759',
    });
    expect(
      parsePlaylistUrl('https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=930054744&redirect_from=node_v2'),
    ).toEqual({ type: 'qq', id: '930054744' });
  });

  it('rejects qq song links（playsong.html 非歌单，#280）', () => {
    expect(parsePlaylistUrl('https://i.y.qq.com/v8/playsong.html?songmid=000XjcLg0fbRjv&type=0')).toBeNull();
    expect(parsePlaylistUrl('https://y.qq.com/n/ryqq/singer/004Z8Ihr0JIu5s')).toBeNull();
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

  it('走批量腿：整批只写一次，逐首 addSong 不再调用', async () => {
    const songs = [song('1', 'A'), song('2', 'B'), song('3', 'C')];
    const addSongs = vi.fn(async (_pid: string | number, _songs: Song[]) => {});
    const d = deps({ addSongs });
    const result = await importFromLink(5, songs, new Set(['1', '2', '3']), [song('3', 'C')], d, progress);
    expect(addSongs).toHaveBeenCalledTimes(1);
    expect(addSongs.mock.calls[0][0]).toBe(5);
    expect(addSongs.mock.calls[0][1].map((s) => s.id)).toEqual(['1', '2']);
    expect(d.addSong).not.toHaveBeenCalled();
    expect(result.successes.map((s) => s.song.id)).toEqual(['1', '2']);
    expect(result.skips).toHaveLength(1);
  });

  it('批量腿抛错：整批记为失败，不静默吞掉', async () => {
    const songs = [song('1', 'A'), song('2', 'B')];
    const addSongs = vi.fn(async (_pid: string | number, _songs: Song[]) => {
      throw new Error('boom');
    });
    const d = deps({ addSongs });
    const result = await importFromLink(5, songs, new Set(['1', '2']), [], d, progress);
    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
  });
});
