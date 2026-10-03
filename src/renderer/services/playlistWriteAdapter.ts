import type { Song } from '@mplayer/core';
import {
  createPlaylistSnapshot,
  writeSongsToPlaylist,
  DEFAULT_PLAYLIST_CAPACITY,
} from '@mplayer/core';
import type {
  NameConflictDecisions,
  PlaylistNameConflict,
  PlaylistWriteResult,
  PlaylistWriteDeps,
} from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';

/**
 * 桌面歌单写入 adapter（#552）。
 *
 * 此前桌面**没有 adapter 这个 module**，只有三份逐字相同的 helper
 * （AddToPlaylistModal / BatchAddToPlaylistModal / importService 各一份：
 * 先 `playlist:get` 校验存在、再 `playlist:addSong`），以及四处各写各的编排。
 * 本 module 是桌面唯一的写入落点：**IPC 形状与编排藏在 adapter 后**，
 * 调用点只留「文案与关闭时机」。
 *
 * 两个宿主回调（#553 的 interface 要求）：
 * - **读目标歌单**：`playlist:getSongs`（+ 容量上限事实），产出 `PlaylistSnapshot`；
 * - **同名时怎么办**：`resolveNameConflict`，一次收整批冲突，交调用方裁决。
 *
 * #554：`addSongs` 走 `playlist:addSongs` 并**回传宿主真实新增数`**，
 * 不再让 core 的 `added` 变成「请求数」。
 */

/** 桌面 adapter 依赖的 IPC 面（只依赖这一个方法，测试可塞假实现）。 */
export interface DesktopPlaylistIpcPort {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
}

export interface DesktopPlaylistWriter {
  /** 读目标歌单快照（已有曲目 + 容量）——渲染层预览判据用同一份事实。 */
  readTarget(playlistId: string | number): Promise<{ songs: Song[]; capacity: number }>;
  /** 往已有歌单写入；结果契约见 core `PlaylistWriteResult`。 */
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
    description?: string;
    resolveNameConflict?: (
      conflicts: readonly PlaylistNameConflict[],
    ) => Promise<NameConflictDecisions> | NameConflictDecisions;
  }): Promise<PlaylistWriteResult>;
}

/** 缺省 IPC 面 = IpcClient（与渲染层其余调用同一通道，测试可只 mock 它）。 */
const defaultPort: DesktopPlaylistIpcPort = {
  invoke: <T>(channel: string, ...args: unknown[]) => IpcClient.invoke<T>(channel, ...args),
};

/**
 * 造一个桌面写入 adapter。
 * @param ipc 缺省走 `IpcClient`（渲染层唯一 IPC 通道）
 */
export function createDesktopPlaylistWriter(
  ipc: DesktopPlaylistIpcPort = defaultPort,
): DesktopPlaylistWriter {
  const invoke = ipc.invoke.bind(ipc);

  const readTarget = async (playlistId: string | number) => {
    const pid = Number(playlistId);
    const songs = await invoke<Song[]>('playlist:getSongs', pid);
    // 容量事实来自 core（#554 随目标快照进 interface；上限只允许一个落点）。
    return { songs: songs ?? [], capacity: DEFAULT_PLAYLIST_CAPACITY };
  };

  const makeDeps = (
    resolveNameConflict?: (
      conflicts: readonly PlaylistNameConflict[],
    ) => Promise<NameConflictDecisions> | NameConflictDecisions,
  ): PlaylistWriteDeps => ({
    // 批量腿（#552：桌面链接导入从每首 2 次 IPC 降到 1 + 1）——回传真实新增数（#554）
    addSongs: async (pid, songs) => {
      const added = await invoke<number[]>('playlist:addSongs', Number(pid), songs);
      return Array.isArray(added) ? added.length : songs.length;
    },
    addSong: async (pid, song) => {
      await invoke<number>('playlist:addSong', Number(pid), song);
    },
    // core 只传歌单名；描述由 `createAndAdd` 的调用点覆盖（见下）。
    createPlaylist: (name) => invoke<number>('playlist:create', name),
    deletePlaylist: async (pid) => {
      await invoke('playlist:delete', Number(pid));
    },
    resolveNameConflict,
  });

  return {
    readTarget,
    add: async ({ playlistId, songs, resolveNameConflict }) => {
      const target = await readTarget(playlistId);
      return writeSongsToPlaylist(
        { playlistId, target: createPlaylistSnapshot(target), songs },
        makeDeps(resolveNameConflict),
      );
    },
    createAndAdd: async ({ name, songs, description, resolveNameConflict }) =>
      writeSongsToPlaylist(
        { createName: name, songs },
        {
          ...makeDeps(resolveNameConflict),
          // 没有描述时不给第三个实参：保持 `playlist:create(name)` 的既有 IPC 形状。
          createPlaylist: (n) =>
            description === undefined
              ? invoke<number>('playlist:create', n)
              : invoke<number>('playlist:create', n, description),
        },
      ),
  };
}
