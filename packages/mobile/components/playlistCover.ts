import type { Song } from '@mplayer/core';

/**
 * 应用自己生成的歌单主图 = 第一首歌封面（用户 2026-11-16 决策）。
 * 不拼 2×2 / 多图；没有歌时返回 null，由调用方显示中性占位。
 */
export function playlistCoverSong(songs: Song[]): Song | null {
  return songs[0] ?? null;
}
