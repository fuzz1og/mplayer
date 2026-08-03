import { musicApi, findBestMatch } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';

/**
 * 换源：把一组歌曲逐首用其他音乐源搜索完整版。
 * 网易云 VIP 歌经 API/weapi 只能拿 30 秒片段；QQ/酷狗等其他源通常有完整版。
 * 逐首搜索 → findBestMatch 精确匹配（防翻唱/remix）→ 替换为换源结果。
 * 匹配失败的歌保留原歌（30 秒片段可播），由调用方提示统计。
 */
export async function swapSongsToSource(songs: Song[], source: SourceKey): Promise<Song[]> {
  const results = await Promise.all(
    songs.map(async (song) => {
      if (song.sourceType === source) return song; // 已是目标源
      if (!song.name) return song;
      try {
        const candidates = await musicApi.searchSongs(`${song.name} ${song.artist}`, 1, source);
        const match = findBestMatch({ name: song.name, artist: song.artist }, candidates);
        const matched = match?.song as Song | undefined;
        if (matched?.url) {
          return {
            ...matched,
            sourceType: source,
            // 保留原 id 避免队列 key 冲突；lrc 用换源结果的歌词地址
            id: `${source}:${song.id}`,
            name: song.name,
            artist: song.artist,
          } as Song;
        }
      } catch {
        // 单首搜索失败保留原歌
      }
      return song;
    })
  );
  return results;
}

/** 换源统计：成功替换多少首 */
export function countSwapped(original: Song[], swapped: Song[]): number {
  return swapped.filter((s, i) => s !== original[i] && s.sourceType !== original[i]?.sourceType).length;
}
