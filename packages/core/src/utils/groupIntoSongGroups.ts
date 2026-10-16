import type { Song, SongGroup } from '../types/index.js';

/**
 * 深度约束：多源渐进搜索依赖「固定源序拼装 → 此分组」保证「逐源到达顺序不改最终分组」不变量——调
 * 用方需按固定源序传 songs。
 */
export function groupIntoSongGroups(allSongs: Song[]): SongGroup[] {
  const map = new Map<string, SongGroup>();
  for (const song of allSongs) {
    const key = `${song.name.trim().toLowerCase()}|${song.artist.trim().toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      existing.songs.push(song);
    } else {
      map.set(key, { key, name: song.name, artist: song.artist, songs: [song] });
    }
  }
  return Array.from(map.values());
}
