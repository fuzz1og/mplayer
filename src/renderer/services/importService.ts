import {
  parsePlaylistUrl,
  importFromLink as coreImportFromLink,
} from '@mplayer/core';
import type { ImportSource } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import type {
  PlaylistUrlInfo,
  ProgressState,
  ImportResult,
  PlaylistImportDeps,
} from '@mplayer/core';
import { createDesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import type { DesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';

// 兼容旧导出名（ImportPlaylistModal / 测试仍引用）
export type SourceType = ImportSource;
export type { PlaylistUrlInfo, ProgressState, ImportResult };
export { parsePlaylistUrl };

/** 桌面唯一的歌单写入 adapter（#552）——IPC 形状与编排都在它后面。 */
export const desktopPlaylistWriter: DesktopPlaylistWriter = createDesktopPlaylistWriter();

/**
 * 链接导入的外部依赖（#552）。
 *
 * 此前只注入逐首 `addSong` → 每首歌 2 次 IPC（`playlist:get` 校验 + `playlist:addSong`）。
 * 现在整批腿走 adapter 的 `playlist:addSongs` → **1 + 1 次**（读一次快照 + 写一次）。
 */
export function importDepsFor(writer: DesktopPlaylistWriter = desktopPlaylistWriter): PlaylistImportDeps {
  return {
    addSong: async (playlistId, song) => {
      const result = await writer.add({ playlistId, songs: [song] });
      if (!result.ok) throw new Error(result.error || '添加失败');
    },
    addSongs: async (playlistId, songs) => {
      const result = await writer.add({ playlistId, songs });
      if (!result.ok) throw new Error(result.error || '添加失败');
    },
  };
}

export function importFromLink(
  playlistId: number,
  songs: Song[],
  selectedSongIds: Set<string>,
  existingSongs: Song[],
  onProgress: (state: ProgressState) => void
): Promise<ImportResult> {
  return coreImportFromLink(
    playlistId,
    songs,
    selectedSongIds,
    existingSongs,
    importDepsFor(),
    onProgress,
  );
}
