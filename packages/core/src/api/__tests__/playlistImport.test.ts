import { describe, expect, it, vi } from 'vitest';
import { parsePlaylistUrl, importFromLink, importDepsFor } from '../playlistImport.js';
import type { PlaylistImportDeps, PlaylistImportWriterPort } from '../playlistImport.js';
import type { PlaylistWriteResult } from '../../shared/playlistWrite.js';
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

  it('netease 直链只认 /playlist 路径：song/album/artist 带同一 id 也不误判', () => {
    expect(parsePlaylistUrl('https://music.163.com/song?id=123456')).toBeNull();
    expect(parsePlaylistUrl('https://music.163.com/album?id=123456')).toBeNull();
    expect(parsePlaylistUrl('https://music.163.com/artist?id=123456')).toBeNull();
    // 手机端域名与 hash 路由照旧
    expect(parsePlaylistUrl('https://y.music.163.com/m/playlist?id=123456')).toEqual({ type: 'netease', id: '123456' });
    expect(parsePlaylistUrl('https://music.163.com/#/playlist?id=123456&userid=9')).toEqual({ type: 'netease', id: '123456' });
    // 分享文案里夹带的链接照旧识别（保留旧容忍度）
    expect(parsePlaylistUrl('分享我的歌单 https://music.163.com/playlist?id=123456 来自网易云')).toEqual({ type: 'netease', id: '123456' });
  });

  it('病态重复前缀线性返回（ReDoS 回归：不再用 music.163.com.* 回溯正则）', () => {
    // 旧正则 music\.163\.com.*\/playlist...[?&]id= 在「重复 music.163.com 前缀」上是
    // O(n²)。这里给宽裕但有意义的墙钟上限（新实现 ~5ms）。
    const evil = 'music.163.com'.repeat(12000);
    const startedAt = Date.now();
    expect(parsePlaylistUrl(evil)).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1500);
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

  // #556 评审 B6：宿主调了写入却丢掉结果（哪怕只写进去一半），编排仍把整批记 success
  // 就是谎报——真实新增数由宿主回报。
  it('⭐ 批量腿宿主只收下一半 → 剩下的记 failure，不整批记 success', async () => {
    const songs = [song('1', 'A'), song('2', 'B'), song('3', 'C')];
    const addSongs = vi.fn(async (_pid: string | number, list: Song[]) => list.length - 1);
    const d = deps({ addSongs });
    const result = await importFromLink(5, songs, new Set(['1', '2', '3']), [], d, progress);
    expect(result.successes).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
  });

  it('⭐ 逐首腿宿主回报 0（没写进去）→ 记 skip，不记 success', async () => {
    const songs = [song('1', 'A'), song('2', 'B')];
    const addSong = vi.fn(async (_pid: string | number, s: Song) => (s.id === '2' ? 0 : 1));
    const d = deps({ addSong });
    const result = await importFromLink(5, songs, new Set(['1', '2']), [], d, progress);
    expect(result.successes.map((s) => s.song.id)).toEqual(['1']);
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

/** 造一个最小写入 adapter 替身（#594：装配只认 add 的返回值）。 */
function writer(add: PlaylistImportWriterPort['add']): PlaylistImportWriterPort {
  return { add };
}

/**
 * #594：链接导入的写入 deps 装配此前在两端逐字各一份（renderer importService 与
 * mobile playlistExport），删掉任意一份另一份原样可用。下沉 core 后，行为在这里
 * 单点验证；两端只剩「默认 writer」的转调。
 */
describe('importDepsFor（#594：双端唯一一份装配）', () => {
  it('批量腿整批一次写，回传宿主真实新增数', async () => {
    const add = vi.fn(async () => ({ ok: true, added: 1 } as PlaylistWriteResult));
    const batch = [song('1', 'A'), song('2', 'B'), song('3', 'C')];

    expect(await importDepsFor(writer(add)).addSongs!(7, batch)).toBe(1);
    // 一次调用、整批过去（不拆成逐首），且不多带 resolveNameConflict——
    // 导入是无人值守的整批操作，同名走 core 默认并入（#556 评审 A4）。
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({ playlistId: 7, songs: batch });
  });

  it('逐首腿回传宿主真实新增数（0 = 宿主没收下，不吞成 success）', async () => {
    const add = vi.fn(async () => ({ ok: true, added: 0 } as PlaylistWriteResult));
    const one = song('1', 'A');

    expect(await importDepsFor(writer(add)).addSong('pl-1', one)).toBe(0);
    expect(add).toHaveBeenCalledWith({ playlistId: 'pl-1', songs: [one] });
  });

  it('宿主报失败 → 抛宿主原文；无原文 → 抛「添加失败」（core 记 failure，不记 success）', async () => {
    const failed = vi.fn(async () => ({ ok: false, added: 0, error: '歌单不存在' } as PlaylistWriteResult));
    await expect(importDepsFor(writer(failed)).addSongs!('pl-1', [song('1', 'A')])).rejects.toThrow('歌单不存在');

    const silent = vi.fn(async () => ({ ok: false, added: 0, error: '' } as PlaylistWriteResult));
    await expect(importDepsFor(writer(silent)).addSong('pl-1', song('1', 'A'))).rejects.toThrow('添加失败');
  });
});

