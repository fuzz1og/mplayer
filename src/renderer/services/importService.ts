import {
  parsePlaylistUrl,
  importFromLink as coreImportFromLink,
  importDepsFor as coreImportDepsFor,
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
 * 链接导入的外部依赖（#552；#594 装配下沉 core）。
 *
 * 装配本体在 core `importDepsFor`——桌面**不再持有第二份**：这里只把
 * 「默认 writer」这一件事接上（桌面整批腿走 adapter 的 `playlist:addSongs`，
 * 1 + 1 次 IPC：读一次快照 + 写一次）。口径（默认并入、回报真实新增数）
 * 见 core 的注释。
 */
export function importDepsFor(writer: DesktopPlaylistWriter = desktopPlaylistWriter): PlaylistImportDeps {
  return coreImportDepsFor(writer);
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
