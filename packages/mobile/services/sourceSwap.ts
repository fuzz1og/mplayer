import { musicApi, findBestMatch } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';

/**
 * 单曲换源：用其他音乐源搜索这首歌的完整版。
 * 网易云 VIP 歌经 API/weapi 只能拿 30 秒片段；QQ/酷狗等其他源通常有完整版。
 * findBestMatch 精确匹配防翻唱/remix；匹配失败返回 null（保留原歌）。
 */
export async function swapSongToSource(song: Song, source: SourceKey): Promise<Song | null> {
  if (song.sourceType === source || !song.name) return null;
  try {
    const candidates = await musicApi.searchSongs(`${song.name} ${song.artist}`, 1, source);
    const match = findBestMatch({ name: song.name, artist: song.artist }, candidates);
    const matched = match?.song as Song | undefined;
    if (!matched?.url) return null;
    return {
      ...matched,
      sourceType: source,
      // 保留原 id 避免队列/收藏 key 冲突
      id: `${source}:${song.id}`,
      name: song.name,
      artist: song.artist,
    } as Song;
  } catch {
    return null;
  }
}
