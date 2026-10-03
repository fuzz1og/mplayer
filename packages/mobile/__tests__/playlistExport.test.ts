import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaylistStore } from '../stores/playlistStore';
import {
  createMobilePlaylistWriter,
  exportSongsToLocalPlaylist,
} from '../services/playlistExport';
import type { Song } from '@mplayer/core';

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
    addSong: (id: string, s: Song) => {
      const list = playlists.get(id) ?? [];
      if (!list.some((x) => x.id === s.id)) list.push(s);
      playlists.set(id, list);
      return 1;
    },
    addSongs: (id: string, songs: Song[]) => {
      const list = playlists.get(id) ?? [];
      const have = new Set(list.map((x) => x.id));
      const fresh = songs.filter((s) => !have.has(s.id));
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
    const addSongs = vi.fn((playlistId: string, list: Song[]) => {
      store.addSongs(playlistId, list);
    });

    const result = await exportSongsToLocalPlaylist({ createPlaylist, addSongs }, '网络歌单', songs);

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
      },
      '网易热歌',
      songs,
    );

    const all = usePlaylistStore.getState().playlists;
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('网易热歌');
    expect(all[0].songs.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('addSongs 抛错 → ok=false 且已回滚（不留空歌单），不静默吞错', async () => {
    const createPlaylist = vi.fn((_name: string) => 'pl-x');
    const addSongs = vi.fn((_playlistId: string, _songs: Song[]) => {
      throw new Error('存储写入失败');
    });

    const result = await exportSongsToLocalPlaylist({ createPlaylist, addSongs }, '会失败', [song('a')]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('存储写入失败');
    expect(createPlaylist).toHaveBeenCalledTimes(1);
    expect(addSongs).toHaveBeenCalledTimes(1);
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
