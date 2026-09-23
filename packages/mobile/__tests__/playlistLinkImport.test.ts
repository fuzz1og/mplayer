import { describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';
import { fetchPlaylistSongsFromLink, type PlaylistLinkDeps } from '../services/playlistLinkImport';

function song(id: string, name = '晴天'): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

function makeDeps(overrides: Partial<PlaylistLinkDeps> = {}): PlaylistLinkDeps {
  return {
    fetchQqPlaylist: vi.fn(async (_source: string | number) => [song('q1')]),
    fetchNeteasePlaylist: vi.fn(async (_id: number) => [song('n1')]),
    resolveRedirect: vi.fn(async (url: string) => url),
    ...overrides,
  };
}

describe('fetchPlaylistSongsFromLink（链接 → 歌曲）', () => {
  it('网易完整链接 → 按 id 取全量，不碰 QQ 腿', async () => {
    const deps = makeDeps();
    const songs = await fetchPlaylistSongsFromLink('https://music.163.com/#/playlist?id=24381616', deps);
    expect(deps.fetchNeteasePlaylist).toHaveBeenCalledWith(24381616);
    expect(deps.fetchQqPlaylist).not.toHaveBeenCalled();
    expect(songs.map((s) => s.id)).toEqual(['n1']);
  });

  it('网易短链 → 先跟重定向，用落地 URL 重新识别', async () => {
    const deps = makeDeps({
      resolveRedirect: vi.fn(async (_url: string) => 'https://music.163.com/playlist?id=999'),
    });
    await fetchPlaylistSongsFromLink('https://163cn.tv/abc', deps);
    expect(deps.resolveRedirect).toHaveBeenCalledWith('https://163cn.tv/abc');
    expect(deps.fetchNeteasePlaylist).toHaveBeenCalledWith(999);
  });

  it('网易短链落地不是歌单（如歌曲页）→ 报「短链解析失败」', async () => {
    const deps = makeDeps({
      resolveRedirect: vi.fn(async (_url: string) => 'https://music.163.com/song?id=1'),
    });
    await expect(fetchPlaylistSongsFromLink('https://163cn.tv/abc', deps)).rejects.toThrow('短链解析失败');
    expect(deps.fetchNeteasePlaylist).not.toHaveBeenCalled();
  });

  it('QQ 直链 → 带 id 走 QQ 腿', async () => {
    const deps = makeDeps();
    await fetchPlaylistSongsFromLink('https://y.qq.com/n/ryqq/playlist/7729596131', deps);
    expect(deps.fetchQqPlaylist).toHaveBeenCalledWith('7729596131');
    expect(deps.fetchNeteasePlaylist).not.toHaveBeenCalled();
  });

  it('QQ 分享短链 → 原样交给 core（core 内部跟 302）', async () => {
    const deps = makeDeps();
    await fetchPlaylistSongsFromLink('https://c6.y.qq.com/base/fcgi-bin/u?__=abc', deps);
    expect(deps.fetchQqPlaylist).toHaveBeenCalledWith('https://c6.y.qq.com/base/fcgi-bin/u?__=abc');
  });

  it('无法识别的链接 → 语义化报错且不打任何腿', async () => {
    const deps = makeDeps();
    await expect(fetchPlaylistSongsFromLink('https://example.com/x', deps)).rejects.toThrow('有效的歌单链接');
    expect(deps.fetchNeteasePlaylist).not.toHaveBeenCalled();
    expect(deps.fetchQqPlaylist).not.toHaveBeenCalled();
  });

  it('空歌单 → 报「歌单不存在或没有歌曲」', async () => {
    const deps = makeDeps({ fetchNeteasePlaylist: vi.fn(async (_id: number) => []) });
    await expect(fetchPlaylistSongsFromLink('https://music.163.com/playlist?id=1', deps)).rejects.toThrow(
      '歌单不存在或没有歌曲',
    );
  });
});
