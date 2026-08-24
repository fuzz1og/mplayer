import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Song } from '@mplayer/core';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir,
  },
}));

import { FileStorage } from '../../main/storage/fileStorage';

function song(id: string, name = '晴天', sourceType: Song['sourceType'] = 'netease'): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType, url: `https://audio.example.com/${id}.mp3`, cover: '', lrc: '',
  };
}

beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-storage-'));
});

afterEach(() => {
  if (state.dir) fs.rmSync(state.dir, { recursive: true, force: true });
  state.dir = '';
});

describe('原位替换（单曲换源持久化）', () => {
  it('replacing a favorite keeps creation time and therefore list order', async () => {
    const storage = new FileStorage();
    await storage.addFavorite(song('netease:1'));
    // 确保收藏时间可区分，否则排序断言无意义
    await new Promise(resolve => setTimeout(resolve, 5));
    await storage.addFavorite(song('netease:2'));

    await storage.replaceFavoriteSong('netease:1', song('qq:1', '晴天', 'qq'));

    const favorites = await storage.getFavorites();
    // 原收藏时间不变：netease:2 仍是最新，排最前；被替换的 qq:1 仍在第二位
    expect(favorites.map(f => f.id)).toEqual(['netease:2', 'qq:1']);
    expect(favorites[1].sourceType).toBe('qq');
  });

  it('replacing a favorite makes the old id unresolvable', async () => {
    const storage = new FileStorage();
    await storage.addFavorite(song('netease:1'));

    await storage.replaceFavoriteSong('netease:1', song('qq:1', '晴天', 'qq'));

    expect((await storage.getFavorites()).map(f => f.id)).toEqual(['qq:1']);
    expect(await storage.isFavorite('netease:1')).toBe(false);
  });

  it('replacing a playlist song keeps its order position', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('测试歌单');
    await storage.addSongToPlaylist(playlistId, song('netease:1'));
    await storage.addSongToPlaylist(playlistId, song('netease:2'));
    await storage.addSongToPlaylist(playlistId, song('netease:3'));

    await storage.replacePlaylistSong(playlistId, 'netease:2', song('qq:2', '晴天', 'qq'));

    const songs = await storage.getPlaylistSongs(playlistId);
    expect(songs.map(s => s.id)).toEqual(['netease:1', 'qq:2', 'netease:3']);
    expect(songs[1].sourceType).toBe('qq');
  });
});

describe('歌单加入未解析歌曲（直连架构：搜索结果 url 为空，播放时懒解析）', () => {
  it('accepts a search-result song with empty url (VIP/未探测曲目)', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('测试歌单');
    const unresolved: Song = { ...song('1481587458', 'Take on Me'), artist: 'Various Artists', url: '' };

    await storage.addSongToPlaylist(playlistId, unresolved);

    const songs = await storage.getPlaylistSongs(playlistId);
    expect(songs.map(s => s.id)).toEqual(['1481587458']);
    expect(songs[0].artist).toBe('Various Artists');
  });

  it('still rejects songs missing identity fields', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('测试歌单');

    await expect(storage.addSongToPlaylist(playlistId, { ...song('x'), name: '' })).rejects.toThrow('歌曲数据不完整');
    await expect(storage.addSongToPlaylist(playlistId, { ...song('x'), artist: '' })).rejects.toThrow('歌曲数据不完整');
  });

  it('local songs still require a file path', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('测试歌单');
    const noPath: Song = { ...song('local:1', '本地歌', 'local'), url: '' };

    await expect(storage.addSongToPlaylist(playlistId, noPath)).rejects.toThrow('歌曲数据不完整');
  });
});
