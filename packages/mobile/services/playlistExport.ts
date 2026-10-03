import type { Song } from '@mplayer/core';
import {
  createPlaylistSnapshot,
  writeSongsToPlaylist,
} from '@mplayer/core';
import type {
  NameConflictDecisions,
  PlaylistNameConflict,
  PlaylistWriteResult,
} from '@mplayer/core';
import { usePlaylistStore } from '../stores/playlistStore';

/**
 * 移动端歌单写入 adapter（#552：双端各留一个 adapter）。
 *
 * 桌面走 IPC、移动走 `usePlaylistStore`——**编排与判据都在 core**，
 * 两端只提供两个回调：「读目标歌单」与「同名时怎么办」。
 * 顺带把 #554 的「added 是真值」在移动侧兑现：`addSong` / `addSongs`
 * 改为回报**真实新增数**（本地 store 去重后实际 append 的条数）。
 */

/** 移动端 adapter 依赖的本地 store 面（测试可注入假实现）。 */
export interface MobilePlaylistStorePort {
  /** 目标歌单已有曲目（读快照）。 */
  readSongs(playlistId: string): readonly Song[];
  /** 新建歌单并返回新 id。 */
  createPlaylist(name: string): string;
  /** 删除歌单（回滚用）。 */
  deletePlaylist(id: string): void;
  /** 逐首写入，返回**真实新增**条数（已存在 = 0）。 */
  addSong(playlistId: string, song: Song): number;
  /** 整批写入，返回**真实新增**条数（一次 set = 一次持久化 + 一次渲染）。 */
  addSongs(playlistId: string, songs: Song[]): number;
}

export interface MobilePlaylistWriter {
  /** 读目标歌单快照（已有曲目 + 容量）。 */
  readTarget(playlistId: string | number): { songs: Song[]; capacity: number };
  /** 往已有歌单写入。 */
  add(params: {
    playlistId: string | number;
    songs: readonly Song[];
    resolveNameConflict?: (
      conflicts: readonly PlaylistNameConflict[],
    ) => Promise<NameConflictDecisions> | NameConflictDecisions;
  }): Promise<PlaylistWriteResult>;
  /** 就地新建并写入（失败会删掉刚建的空歌单）。 */
  createAndAdd(params: {
    name: string;
    songs: readonly Song[];
    resolveNameConflict?: (
      conflicts: readonly PlaylistNameConflict[],
    ) => Promise<NameConflictDecisions> | NameConflictDecisions;
  }): Promise<PlaylistWriteResult>;
}

/** 移动端本地歌单容量事实（本地 store 无硬上限，取与桌面同口径的默认值）。 */
const MOBILE_PLAYLIST_CAPACITY = 1000;

/**
 * 造一个移动端写入 adapter。
 *
 * `port` 缺省在每次调用时读 `usePlaylistStore.getState()`——
 * 避免模块加载期把 store 快照钉死。
 */
export function createMobilePlaylistWriter(port?: MobilePlaylistStorePort): MobilePlaylistWriter {
  const readSongs = (id: string | number): readonly Song[] => {
    if (port) return port.readSongs(String(id));
    const store = usePlaylistStore.getState();
    return store.playlists.find((p) => p.id === String(id))?.songs ?? [];
  };

  const readTarget = (playlistId: string | number) => ({
    songs: [...readSongs(playlistId)],
    capacity: MOBILE_PLAYLIST_CAPACITY,
  });

  const base = {
    // 逐首腿：core 的 `addSong` 契约是 Promise<void>（真实新增数在整批腿上回报）。
    addSong: async (pid: string | number, song: Song) => {
      const id = String(pid);
      if (port) port.addSong(id, song);
      else usePlaylistStore.getState().addSong(id, song);
    },
    addSongs: async (pid: string | number, songs: Song[]) => {
      const id = String(pid);
      const before = readSongs(id).length;
      if (port) port.addSongs(id, songs);
      else usePlaylistStore.getState().addSongs(id, songs);
      const after = readSongs(id).length;
      return Math.max(0, after - before);
    },
    createPlaylist: async (name: string) =>
      port ? port.createPlaylist(name) : usePlaylistStore.getState().createPlaylist(name),
    deletePlaylist: async (pid: string | number) => {
      if (port) port.deletePlaylist(String(pid));
      else usePlaylistStore.getState().deletePlaylist(String(pid));
    },
  };

  return {
    readTarget,
    add: ({ playlistId, songs, resolveNameConflict }) =>
      writeSongsToPlaylist(
        { playlistId, target: createPlaylistSnapshot(readTarget(playlistId)), songs },
        { ...base, resolveNameConflict },
      ),
    createAndAdd: ({ name, songs, resolveNameConflict }) =>
      writeSongsToPlaylist({ createName: name, songs }, { ...base, resolveNameConflict }),
  };
}

/**
 * 网络歌单 → 新的本地歌单（#492 的落库那一步）。
 *
 * #552 起不再自己拼 create + addSongs：交给 core 写入编排（失败即回滚，不留空歌单）。
 * 命名保留给 `app/discover-playlist/[id].tsx` 的调用点。
 */
export function exportSongsToLocalPlaylist(
  deps: {
    createPlaylist: (name: string) => string;
    addSongs: (playlistId: string, songs: Song[]) => void;
  },
  name: string,
  songs: Song[],
): Promise<PlaylistWriteResult> {
  // 就地新建分支里写入腿是「整批一次 addSongs」，所以新增数就是本次送入的条数；
  // readSongs 只需在写入腿里读得回自己的影子清单（#554 的 added 因此是真值）。
  const shadow = new Map<string, Song[]>();
  const writer = createMobilePlaylistWriter({
    readSongs: (id) => shadow.get(id) ?? [],
    createPlaylist: (n) => {
      const id = deps.createPlaylist(n);
      shadow.set(id, []);
      return id;
    },
    deletePlaylist: () => {},
    addSong: () => 0,
    addSongs: (playlistId, list) => {
      deps.addSongs(playlistId, list);
      const before = shadow.get(playlistId)?.length ?? 0;
      shadow.set(playlistId, list);
      return list.length - before;
    },
  });
  return writer.createAndAdd({ name, songs });
}
