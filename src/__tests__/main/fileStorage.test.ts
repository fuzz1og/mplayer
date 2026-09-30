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
describe('批量加入歌单 addSongsToPlaylist（#493：整批只落一次盘）', () => {
  it('整批一次 saveData，顺序按传入顺序接着 maxOrder 递增', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('榜单');
    await storage.addSongToPlaylist(playlistId, song('seed'));

    const saveSpy = vi.spyOn(storage as unknown as { saveData: (...d: string[]) => Promise<void> }, 'saveData');
    const batch = Array.from({ length: 500 }, (_, i) => song(`n:${i}`, `歌${i}`));

    const added = await storage.addSongsToPlaylist(playlistId, batch);

    expect(added).toHaveLength(500);
    // 整批只落一次盘（逐首 addSongToPlaylist 会是 500 次）
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith('playlistSongs');

    const songs = await storage.getPlaylistSongs(playlistId);
    expect(songs.map(s => s.id)).toEqual(['seed', ...batch.map(s => s.id)]);
  });

  it('按 songId 去重：歌单已有的与本批内部的都跳过，返回真正新增的 id', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('去重');
    await storage.addSongToPlaylist(playlistId, song('a'));

    const added = await storage.addSongsToPlaylist(playlistId, [song('a'), song('b'), song('b'), song('c')]);

    expect(added).toHaveLength(2); // 只有 b、c
    const songs = await storage.getPlaylistSongs(playlistId);
    expect(songs.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('不合法的歌跳过而不是整批抛错（部分成功）', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('脏数据');
    const bad: Song[] = [
      { ...song('x'), name: '' },
      { ...song('local:1', '本地歌', 'local'), url: '' },
    ];

    const added = await storage.addSongsToPlaylist(playlistId, [bad[0], song('ok'), bad[1]]);

    expect(added).toHaveLength(1);
    expect((await storage.getPlaylistSongs(playlistId)).map(s => s.id)).toEqual(['ok']);
  });

  it('容量上限 1000：能放多少放多少，一个都放不进时返回 [] 且不落盘', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('容量');
    await storage.addSongsToPlaylist(playlistId, Array.from({ length: 999 }, (_, i) => song(`full:${i}`)));

    const added = await storage.addSongsToPlaylist(playlistId, [song('over:1'), song('over:2'), song('over:3')]);
    expect(added).toHaveLength(1); // 只剩最后 1 个位

    const saveSpy = vi.spyOn(storage as unknown as { saveData: (...d: string[]) => Promise<void> }, 'saveData');
    const none = await storage.addSongsToPlaylist(playlistId, [song('over:4')]);
    expect(none).toEqual([]);
    expect(saveSpy).not.toHaveBeenCalled(); // 0 首成功：不抛错、也不落盘
    expect(await storage.getPlaylistSongs(playlistId)).toHaveLength(1000);
  });

  it('歌单不存在时抛错（唯一会整批失败的路径）', async () => {
    const storage = new FileStorage();
    await expect(storage.addSongsToPlaylist(9999, [song('a')])).rejects.toThrow('歌单不存在');
  });
});
