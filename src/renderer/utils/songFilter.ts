/**
 * 歌单内过滤（#488）的匹配规则：**歌名 / 歌手**子串命中，大小写不敏感，关键词去首尾空白。
 *
 * 它只派生「展示集合」：不排序、不改动入参、命中项保持在全量顺序里的相对位置——所以清空关键词后
 * 展示顺序与过滤前逐项相同（单测钉住）。空关键词原样返回入参（引用不变，调用方零开销）。
 */
export function filterSongsByQuery<T extends { name: string; artist: string }>(
  songs: readonly T[],
  rawQuery: string,
): readonly T[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return songs;
  return songs.filter(
    (song) => song.name.toLowerCase().includes(query) || song.artist.toLowerCase().includes(query),
  );
}
