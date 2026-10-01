import { describe, it, expect } from 'vitest';
import type { Song } from '../../types/index.js';
import { writeSongsToPlaylist, type PlaylistWriteDeps } from '../playlistWrite.js';

const song = (id: string): Song => ({
  id,
  name: `歌${id}`,
  artist: '歌手',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType: 'netease',
});

function fakeStore() {
  const playlists = new Map<string, Song[]>();
  let seq = 0;
  const calls = { addSongs: 0, addSong: 0, create: 0, del: 0 };
  const deps: PlaylistWriteDeps = {
    addSongs: async (id, songs) => {
      calls.addSongs += 1;
      if (!playlists.has(String(id))) throw new Error('歌单不存在');
      playlists.get(String(id))!.push(...songs);
    },
    addSong: async (id, s) => {
      calls.addSong += 1;
      if (!playlists.has(String(id))) throw new Error('歌单不存在');
      playlists.get(String(id))!.push(s);
    },
    createPlaylist: async () => {
      calls.create += 1;
      const id = String(++seq);
      playlists.set(id, []);
      return id;
    },
    deletePlaylist: async (id) => {
      calls.del += 1;
      playlists.delete(String(id));
    },
  };
  return { deps, calls, playlists };
}

/**
 * #542：歌单写入编排。
 * 此前「往目标歌单写入一批歌」散在 8 处，#493 的验收标准「失败不留空歌单」
 * **只在 2/4 处成立**。这里把三条决策钉死：回滚、整批优先、批内去重。
 */
describe('writeSongsToPlaylist（#542 歌单写入编排）', () => {
  it('已有歌单：整批写入一次（addSongs 优先，不逐首）', async () => {
    const { deps, calls, playlists } = fakeStore();
    playlists.set('1', []);
    const res = await writeSongsToPlaylist({ playlistId: '1', songs: [song('a'), song('b')] }, deps);
    expect(res.ok).toBe(true);
    expect(res.added).toBe(2);
    expect(calls.addSongs).toBe(1);
    expect(calls.addSong).toBe(0);
  });

  it('宿主没有 addSongs → 回落逐首，结果一致', async () => {
    const { deps, calls, playlists } = fakeStore();
    playlists.set('1', []);
    const res = await writeSongsToPlaylist(
      { playlistId: '1', songs: [song('a'), song('b')] },
      { ...deps, addSongs: undefined },
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(2);
    expect(calls.addSong).toBe(2);
  });

  it('批内重复会被去掉并计入 skipped', async () => {
    const { deps, calls } = fakeStore();
    const res = await writeSongsToPlaylist(
      { createName: '新歌单', songs: [song('a'), song('a'), song('b')] },
      deps,
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(1);
    expect(calls.addSongs).toBe(1);
  });

  it('就地新建成功：返回 created=true 且不回滚', async () => {
    const { deps, calls } = fakeStore();
    const res = await writeSongsToPlaylist({ createName: '新歌单', songs: [song('a')] }, deps);
    expect(res).toMatchObject({ ok: true, created: true, rolledBack: false });
    expect(calls.create).toBe(1);
    expect(calls.del).toBe(0);
  });

  it('⭐ 就地新建后写入失败 → 删掉新建的空歌单（#493「失败不留空歌单」）', async () => {
    const { deps, calls, playlists } = fakeStore();
    // 让 addSongs 必定失败
    const failing: PlaylistWriteDeps = {
      ...deps,
      addSongs: async () => {
        throw new Error('写入炸了');
      },
    };
    const res = await writeSongsToPlaylist({ createName: '新歌单', songs: [song('a')] }, failing);
    expect(res.ok).toBe(false);
    expect(res.created).toBe(true);
    expect(res.rolledBack).toBe(true);
    // 关键断言：新建出来的歌单**必须被删掉**，不留下空歌单
    expect(calls.del).toBe(1);
    expect(playlists.size).toBe(0);
  });

  it('回滚也失败 → 如实上报 rolledBack=false（调用方知道有空歌单残留）', async () => {
    const { deps } = fakeStore();
    const failing: PlaylistWriteDeps = {
      ...deps,
      addSongs: async () => {
        throw new Error('写入炸了');
      },
      deletePlaylist: async () => {
        throw new Error('删除也炸了');
      },
    };
    const res = await writeSongsToPlaylist({ createName: '新歌单', songs: [song('a')] }, failing);
    expect(res.ok).toBe(false);
    expect(res.rolledBack).toBe(false);
    expect(res.error).toContain('写入失败');
  });

  it('空批次 / 未指定目标 → 失败且不新建', async () => {
    const { deps, calls } = fakeStore();
    const empty = await writeSongsToPlaylist({ playlistId: '1', songs: [] }, deps);
    expect(empty.ok).toBe(false);
    expect(calls.addSongs).toBe(0);

    const noTarget = await writeSongsToPlaylist({ songs: [song('a')] }, deps);
    expect(noTarget.ok).toBe(false);
    expect(noTarget.error).toBe('未指定目标歌单');
    expect(calls.create).toBe(0);
  });

  it('已有歌单写入失败 → 不回滚（那不是本次建的）', async () => {
    const { deps, calls, playlists } = fakeStore();
    playlists.set('1', []);
    const failing: PlaylistWriteDeps = {
      ...deps,
      addSongs: async () => {
        throw new Error('写入炸了');
      },
    };
    const res = await writeSongsToPlaylist({ playlistId: '1', songs: [song('a')] }, failing);
    expect(res.ok).toBe(false);
    expect(res.rolledBack).toBe(false);
    expect(calls.del).toBe(0); // 已有歌单不该被删
    expect(playlists.has('1')).toBe(true);
  });
});
