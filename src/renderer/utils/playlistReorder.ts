import type { Song } from '@mplayer/core';
import { moveItem } from './reorder';

/**
 * 过滤态拖拽（#703/#488）：把展示集合内的重排映射回全量有序数组。
 * 非可见歌曲的位置与相对顺序保持不动，只有可见行之间互换顺序。
 * 返回新数组，不修改入参。
 */
export function reorderVisibleSongs(
  songs: Song[],
  visibleSongs: Song[],
  fromIndex: number,
  toIndex: number,
): Song[] {
  if (fromIndex === toIndex) return songs;
  const visibleIds = new Set(visibleSongs.map((song) => song.id));
  const reorderedVisible = moveItem(visibleSongs, fromIndex, toIndex);
  const cursor = { value: 0 };
  return songs.map((song) => (visibleIds.has(song.id) ? reorderedVisible[cursor.value++] : song));
}
