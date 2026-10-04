import type { Song } from '@mplayer/core';
import {
  createPlaylistSnapshot,
  writeSongsToPlaylist,
  DEFAULT_PLAYLIST_CAPACITY,
} from '@mplayer/core';
import type {
  NameConflictDecisions,
  PlaylistImportDeps,
  PlaylistNameConflict,
  PlaylistWriteResult,
} from '@mplayer/core';
import { usePlaylistStore } from '../stores/playlistStore';

/**
 * 移动端歌单写入 adapter（#552：双端各留一个 adapter）。
 *
 * 桌面走 IPC、移动走 `usePlaylistStore`——**编排与判据都在 core**，
 * 两端只提供两个回调：「读目标歌单」与「同名时怎么办」。
 * 顺带把 #554 的「added 是真值」在移动侧兑现：`addSongs`
 * 回报**真实新增数**（本地 store 去重后实际 append 的条数）；#559 起本地
 * `playlistStore.addSongs` 直接返回该条数，这里只做透传，不再估算。
 *
 * #556 评审 B2：本地 store 有批量能力，逐首回落端口已删（只有测试 fake 才会只给
 * `addSong`）。链接导入的写入依赖另见 `createMobileImportDeps`（#556 评审 B6）。
 */

/** 移动端 adapter 依赖的本地 store 面（测试可注入假实现）。 */
export interface MobilePlaylistStorePort {
  /** 目标歌单已有曲目（读快照）。 */
  readSongs(playlistId: string): readonly Song[];
  /** 新建歌单并返回新 id。 */
  createPlaylist(name: string): string;
  /** 删除歌单（回滚用）。 */
  deletePlaylist(id: string): void;
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
    // 容量事实来自 core（本地 store 无硬上限，取与桌面同口径的唯一常量）。
    capacity: DEFAULT_PLAYLIST_CAPACITY,
  });

  const base = {
    // 唯一写入端口（#556 评审 B2）：本地 store 有批量能力，逐首回落腿已删。
    // #559：新增数直接取宿主的返回值，不再 readSongs 前后长度差估算——估算在
    // 批内重复、已被判重丢弃、并发写入下都不是真值。
    addSongs: async (pid: string | number, songs: Song[]) => {
      const id = String(pid);
      return port ? port.addSongs(id, songs) : usePlaylistStore.getState().addSongs(id, songs);
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
    /** 整批写入，返回**真实新增**条数（#559：宿主 store 才是真值的来源）。 */
    addSongs: (playlistId: string, songs: Song[]) => number;
    /**
     * 删除歌单（写入失败时的回滚）。
     * **必须是真删**（#556 评审 B4）：此前这里传的是空实现 `() => {}`，core 据此
     * 记 rolledBack=true 并弹「已撤销新建的歌单」，而空歌单还在 store 里——谎报回滚。
     */
    deletePlaylist: (playlistId: string) => void;
  },
  name: string,
  songs: Song[],
): Promise<PlaylistWriteResult> {
  // 影子清单让假端口的读侧自洽（写入腿里 readSongs 读得回自己）；#559 起 added
  // 不再由它算长度差，而是原样透传 deps.addSongs 的返回值。
  const shadow = new Map<string, Song[]>();
  const writer = createMobilePlaylistWriter({
    readSongs: (id) => shadow.get(id) ?? [],
    createPlaylist: (n) => {
      const id = deps.createPlaylist(n);
      shadow.set(id, []);
      return id;
    },
    // 回滚腿接真实删除（#556 评审 B4）：影子清单与宿主 store 一起删。
    deletePlaylist: (id) => {
      deps.deletePlaylist(id);
      shadow.delete(id);
    },
    addSongs: (playlistId, list) => {
      const added = deps.addSongs(playlistId, list);
      shadow.set(playlistId, list);
      return added;
    },
  });
  return writer.createAndAdd({ name, songs });
}

/**
 * 移动端链接导入的写入依赖（#556 评审 B6）。
 *
 * 此前这段直接写在 `PlaylistImportSheet` 里：`await writer.add(...)` 之后**丢掉
 * result 返 void**，于是宿主（本地 store）明明丢歌，core 也按「void = 整批成功」
 * 记账（`playlistImport.ts` 的批量腿）。桌面 `importService.importDepsFor` 早已
 * 回报 `result.added`；这里抽出同形的移动版，带行为测试，由弹窗注入。
 */
export function createMobileImportDeps(
  writer: MobilePlaylistWriter = createMobilePlaylistWriter(),
): PlaylistImportDeps {
  return {
    addSong: async (playlistId, song) => {
      const result = await writer.add({ playlistId, songs: [song] });
      if (!result.ok) throw new Error(result.error || '添加失败');
      return result.added;
    },
    addSongs: async (playlistId, songs) => {
      const result = await writer.add({ playlistId, songs });
      if (!result.ok) throw new Error(result.error || '添加失败');
      return result.added;
    },
  };
}
