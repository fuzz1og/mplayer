import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaylistStore } from '../stores/playlistStore';
import { exportSongsToLocalPlaylist } from '../services/playlistExport';
import type { Song } from '@mplayer/core';

function song(id: string, name = id): Song {
  return { id, name, artist: '测试歌手', sourceType: 'netease' } as Song;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlaylistStore.setState({ playlists: [] });
});

describe('exportSongsToLocalPlaylist（#492 导出到本地歌单）', () => {
  it('落库只走一次 addSongs，且载荷是全量列表（不是逐首写入）', () => {
    const songs = [song('a'), song('b'), song('c')];
    const createPlaylist = vi.fn((_name: string) => 'pl-1');
    const addSongs = vi.fn((_playlistId: string, _songs: Song[]) => {});

    const id = exportSongsToLocalPlaylist({ createPlaylist, addSongs }, '网络歌单', songs);

    expect(id).toBe('pl-1');
    expect(createPlaylist).toHaveBeenCalledTimes(1);
    expect(createPlaylist).toHaveBeenCalledWith('网络歌单');
    expect(addSongs).toHaveBeenCalledTimes(1);
    expect(addSongs).toHaveBeenCalledWith('pl-1', songs);
  });

  it('导出后歌单列表可见同名歌单，曲目数与网络歌单一致', () => {
    const songs = [song('a'), song('b')];
    exportSongsToLocalPlaylist(
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

  it('addSongs 抛错时不再吞错（调用方据此提示失败、不静默留空歌单）', () => {
    const createPlaylist = vi.fn((_name: string) => 'pl-x');
    const addSongs = vi.fn((_playlistId: string, _songs: Song[]) => {
      throw new Error('存储写入失败');
    });

    expect(() => exportSongsToLocalPlaylist({ createPlaylist, addSongs }, '会失败', [song('a')])).toThrow(
      '存储写入失败',
    );
    expect(createPlaylist).toHaveBeenCalledTimes(1);
    expect(addSongs).toHaveBeenCalledTimes(1);
  });
});
