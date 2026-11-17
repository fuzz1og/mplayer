import type { Song } from '@mplayer/core';

/**
 * 每日推荐卡头的副标题：`5 首 · 24 分钟`。
 * 时长是用户决定「现在要不要开始听」的信息，但源数据可能缺 duration（0 / NaN）——
 * 全缺时只显示首数，不显示「0 分钟」。
 */
export function formatBatchMeta(songs: Song[]): string {
  const totalSeconds = songs.reduce(
    (sum, song) => sum + (Number.isFinite(song.duration) && song.duration > 0 ? song.duration : 0),
    0,
  );
  const minutes = Math.round(totalSeconds / 60);
  return minutes > 0 ? `${songs.length} 首 · ${minutes} 分钟` : `${songs.length} 首`;
}
