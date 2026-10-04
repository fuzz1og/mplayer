import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaylistStore } from '../stores/playlistStore';
import {
  createMobileImportDeps,
  createMobilePlaylistWriter,
  exportSongsToLocalPlaylist,
} from '../services/playlistExport';
import type { MobilePlaylistWriter } from '../services/playlistExport';
import type { PlaylistWriteResult, Song } from '@mplayer/core';

function song(id: string, name = id): Song {
  return { id, name, artist: '测试歌手', sourceType: 'netease' } as Song;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlaylistStore.setState({ playlists: [] });
});

/** 带状态的假 store：写入后 readSongs 能读到，adapter 才拿得到真实新增数（#554）。 */
function statefulStore() {
  const playlists = new Map<string, Song[]>();
  let seq = 0;
  return {
    playlists,
    readSongs: (id: string) => playlists.get(id) ?? [],
    createPlaylist: (_name: string) => {
      const id = `pl-${++seq}`;
      playlists.set(id, []);
      return id;
    },
    deletePlaylist: (id: string) => {
      playlists.delete(id);
    },
    addSongs: (id: string, songs: Song[]) => {
      const list = playlists.get(id) ?? [];
      const have = new Set(list.map((x) => x.id));
      // 与 store 同判据：边收边并入 have，批内重复只收第一条，返回值才等于真实新增数。
      const fresh = songs.filter((s) => {
        if (have.has(s.id)) return false;
        have.add(s.id);
        return true;
      });
      playlists.set(id, [...list, ...fresh]);
      return fresh.length;
    },
  };
}

describe('exportSongsToLocalPlaylist（#492 导出到本地歌单）', () => {
  it('落库只走一次 addSongs，且载荷是全量列表（不是逐首写入）', async () => {
    const songs = [song('a'), song('b'), song('c')];
    const store = statefulStore();
    const createPlaylist = vi.fn((name: string) => store.createPlaylist(name));
    const addSongs = vi.fn((playlistId: string, list: Song[]) =>
      store.addSongs(playlistId, list),
    );

    const result = await exportSongsToLocalPlaylist(
      { createPlaylist, addSongs, deletePlaylist: (id: string) => store.deletePlaylist(id) },
      '网络歌单',
      songs,
    );

    expect(result.ok).toBe(true);
    expect(result.playlistId).toBe('pl-1');
    expect(createPlaylist).toHaveBeenCalledTimes(1);
    expect(createPlaylist).toHaveBeenCalledWith('网络歌单');
    expect(addSongs).toHaveBeenCalledTimes(1);
    expect(addSongs).toHaveBeenCalledWith('pl-1', songs);
  });

  it('导出后歌单列表可见同名歌单，曲目数与网络歌单一致', async () => {
    const songs = [song('a'), song('b')];
    await exportSongsToLocalPlaylist(
      {
        createPlaylist: (name) => usePlaylistStore.getState().createPlaylist(name),
        addSongs: (playlistId, list) => usePlaylistStore.getState().addSongs(playlistId, list),
        deletePlaylist: (playlistId) => usePlaylistStore.getState().deletePlaylist(playlistId),
      },
      '网易热歌',
      songs,
    );

    const all = usePlaylistStore.getState().playlists;
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('网易热歌');
    expect(all[0].songs.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('⭐ added 取 deps.addSongs 的返回值（#559），不再用影子清单长度差编数', async () => {
    const songs = [song('a'), song('b'), song('c')];
    const result = await exportSongsToLocalPlaylist(
      {
        createPlaylist: () => 'pl-x',
        addSongs: () => 1, // 宿主只收下 1 首
        deletePlaylist: () => {},
      },
      '网络歌单',
      songs,
    );

    // 修前：影子清单记下整批 3 条，按长度差谎报「已导出 3 首」。
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
  });

  // #556 评审 B4：回滚腿此前传的是空实现 deletePlaylist: () => {}——core 记
  // rolledBack=true 并弹「已撤销新建的歌单」，而空歌单还在 store 里。本用例把
  // 「确实调了真删、store 里也确实没有了」一起断言；旧实现两处都红。
  it('⭐ addSongs 抛错 → ok=false，且回滚真的删掉新歌单（不留空歌单）', async () => {
    const store = statefulStore();
    const id = store.createPlaylist('会失败');
    const createPlaylist = vi.fn((_name: string) => id);
    const addSongs = vi.fn((_playlistId: string, _songs: Song[]) => {
      throw new Error('存储写入失败');
    });
    const deletePlaylist = vi.fn((playlistId: string) => store.deletePlaylist(playlistId));

    const result = await exportSongsToLocalPlaylist(
      { createPlaylist, addSongs, deletePlaylist },
      '会失败',
      [song('a')],
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('存储写入失败');
    expect(result.rolledBack).toBe(true);
    expect(createPlaylist).toHaveBeenCalledTimes(1);
    expect(addSongs).toHaveBeenCalledTimes(1);
    expect(deletePlaylist).toHaveBeenCalledWith(id);
    expect(store.playlists.has(id)).toBe(false); // 空歌单没留下
  });
});

/**
 * #552：移动端写入 adapter —— 双端各留一个 adapter，编排与判据都在 core。
 * #554：`added` 是本地 store 的**真实新增数**（去重后实际 append 的条数）。
 */
describe('createMobilePlaylistWriter（#552 移动端写入 adapter）', () => {
  it('批量写入一次 set，added = 真实新增数（已存在的不计入）', async () => {
    const id = usePlaylistStore.getState().createPlaylist('目标');
    usePlaylistStore.getState().addSong(id, song('a'));

    const listener = vi.fn();
    const unsubscribe = usePlaylistStore.subscribe(listener);
    const result = await createMobilePlaylistWriter().add({
      playlistId: id,
      songs: [song('a'), song('b'), song('c')],
    });
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1); // 一次 set = 一次持久化 + 一次渲染
  });

  it('⭐ added 取宿主返回值，不再靠 readSongs 前后长度差估算（#559）', async () => {
    const store = statefulStore();
    // 宿主确实写进去了，但读侧看不到增量（并发写入 / 视图滞后）——旧实现按长度差会回报 0。
    const writer = createMobilePlaylistWriter({
      ...store,
      readSongs: () => [],
      addSongs: (id, songs) => {
        store.addSongs(id, songs);
        return songs.length;
      },
    });

    const result = await writer.add({ playlistId: 'pl-1', songs: [song('a'), song('b')] });

    expect(result.ok).toBe(true);
    expect(result.added).toBe(2);
  });

  it('就地新建写入失败 → 回滚删除新歌单（#493：不留空歌单）', async () => {
    const store = statefulStore();
    const writer = createMobilePlaylistWriter({
      ...store,
      addSongs: () => {
        throw new Error('存储写入失败');
      },
    });

    const result = await writer.createAndAdd({ name: '会失败', songs: [song('a')] });

    expect(result.ok).toBe(false);
    expect(result.created).toBe(true);
    expect(result.rolledBack).toBe(true);
  });

  it('同名异源交 resolveNameConflict 裁决；裁决 add 时并入', async () => {
    const id = usePlaylistStore.getState().createPlaylist('目标');
    usePlaylistStore.getState().addSong(id, { ...song('n1', '晴天'), artist: '周杰伦', sourceType: 'netease' });

    const resolver = vi.fn(async () => 'add' as const);
    const result = await createMobilePlaylistWriter().add({
      playlistId: id,
      songs: [{ ...song('q1', '晴天'), artist: '周杰伦', sourceType: 'qq' }],
      resolveNameConflict: resolver,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result.added).toBe(1);
    expect(result.duplicateNames).toBe(1);
  });
});

/** 造一个只关心 add 返回值的写入 adapter 替身（#556 评审 B6 的行为测法）。 */
function stubWriter(add: MobilePlaylistWriter['add']): MobilePlaylistWriter {
  return {
    readTarget: () => ({ songs: [], capacity: 1000 }),
    add,
    createAndAdd: async () => ({ added: 0, ok: true } as PlaylistWriteResult),
  };
}

/**
 * #556 评审 B6：移动链接导入此前在 PlaylistImportSheet 里 `await writer.add` 后
 * **丢掉 result 返 void**——宿主丢歌时 core 按「void = 整批成功」记账，导入结果谎报成功。
 * 这里把 deps 抽出来做行为测试：宿主真实新增数必须回传，报失败必须抛错。
 */
describe('createMobileImportDeps（#556 评审 B6：链接导入不再吞写入结果）', () => {
  it('⭐ addSongs 回传宿主真实新增数（宿主丢歌时不再谎报整批成功）', async () => {
    const writer = stubWriter(vi.fn(async () => ({ added: 1, ok: true } as PlaylistWriteResult)));
    const deps = createMobileImportDeps(writer);

    const reported = await deps.addSongs!('pl-1', [song('a'), song('b'), song('c')]);

    // 修前内联 deps 返回 void → core 把 3 首全记 success；修后只有真写进去的 1 首。
    expect(reported).toBe(1);
  });

  it('addSong 单首腿也回传真实新增数（0 = 宿主没收下）', async () => {
    const writer = stubWriter(vi.fn(async () => ({ added: 0, ok: true } as PlaylistWriteResult)));
    const deps = createMobileImportDeps(writer);

    expect(await deps.addSong('pl-1', song('a'))).toBe(0);
  });

  it('宿主报失败 → 抛错（core 记失败，不记 success）', async () => {
    const writer = stubWriter(
      vi.fn(async () => ({ added: 0, ok: false, error: '歌单不存在' } as PlaylistWriteResult)),
    );
    const deps = createMobileImportDeps(writer);

    await expect(deps.addSongs!('pl-1', [song('a')])).rejects.toThrow('歌单不存在');
  });
});
