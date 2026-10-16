import type { Song } from '@mplayer/core';

/**
 * 列表内**原位替换**一首歌（单曲换源后更新本地列表，#411）。
 * 它是 `SongRow` 的 `onSwap` 回调，必须用**函数式更新**才能做到零依赖——依赖 `songs` 会让回调每次
 * 列表变化就换引用，把行组件的 memo 击穿。
 */
export function replaceSongInList(list: Song[], originalId: string, swapped: Song): Song[] {
  return list.map((song) => (song.id === originalId ? swapped : song));
}
