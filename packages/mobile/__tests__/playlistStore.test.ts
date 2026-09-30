import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaylistStore } from '../stores/playlistStore';
import type { Song } from '@mplayer/core';

function song(id: string, name = id): Song {
  return { id, name, artist: '测试歌手', sourceType: 'netease' } as Song;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlaylistStore.setState({ playlists: [] });
});

describe('playlistStore.createPlaylist（就地新建的公共前置）', () => {
  it('返回新歌单 id，且该 id 能立刻用于写入', () => {
    const id = usePlaylistStore.getState().createPlaylist('新歌单');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    usePlaylistStore.getState().addSongs(id, [song('a'), song('b')]);
    const created = usePlaylistStore.getState().playlists.find((p) => p.id === id);
    expect(created?.name).toBe('新歌单');
    expect(created?.songs.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('连续新建返回互不相同的 id', () => {
    const a = usePlaylistStore.getState().createPlaylist('A');
    const b = usePlaylistStore.getState().createPlaylist('B');
    expect(a).not.toBe(b);
    expect(usePlaylistStore.getState().playlists.map((p) => p.id)).toEqual([a, b]);
  });
});

describe('playlistStore.removeSongs（批量移除一次 set）', () => {
  it('移除 N 首只触发 1 次 store 更新，其余保持原有相对顺序', () => {
    const id = usePlaylistStore.getState().createPlaylist('批量移除');
    usePlaylistStore.getState().addSongs(id, [song('a'), song('b'), song('c'), song('d')]);

    const listener = vi.fn();
    const unsubscribe = usePlaylistStore.subscribe(listener);

    usePlaylistStore.getState().removeSongs(id, ['b', 'd']);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    const target = usePlaylistStore.getState().playlists.find((p) => p.id === id);
    expect(target?.songs.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('重复 id 按集合语义处理，不会多删', () => {
    const id = usePlaylistStore.getState().createPlaylist('去重');
    usePlaylistStore.getState().addSongs(id, [song('a'), song('b')]);
    usePlaylistStore.getState().removeSongs(id, ['a', 'a', 'a']);
    const target = usePlaylistStore.getState().playlists.find((p) => p.id === id);
    expect(target?.songs.map((s) => s.id)).toEqual(['b']);
  });

  it('空数组不触发 store 更新', () => {
    const id = usePlaylistStore.getState().createPlaylist('空数组');
    usePlaylistStore.getState().addSongs(id, [song('a')]);

    const listener = vi.fn();
    const unsubscribe = usePlaylistStore.subscribe(listener);
    usePlaylistStore.getState().removeSongs(id, []);
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });

  it('只影响目标歌单', () => {
    const a = usePlaylistStore.getState().createPlaylist('A');
    const b = usePlaylistStore.getState().createPlaylist('B');
    usePlaylistStore.getState().addSongs(a, [song('a1'), song('a2')]);
    usePlaylistStore.getState().addSongs(b, [song('a1'), song('b1')]);

    usePlaylistStore.getState().removeSongs(a, ['a1']);

    const pa = usePlaylistStore.getState().playlists.find((p) => p.id === a);
    const pb = usePlaylistStore.getState().playlists.find((p) => p.id === b);
    expect(pa?.songs.map((s) => s.id)).toEqual(['a2']);
    expect(pb?.songs.map((s) => s.id)).toEqual(['a1', 'b1']);
  });
});
