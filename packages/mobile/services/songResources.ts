import { musicApi, findBestMatch } from '@mplayer/core';
import type { Song } from '@mplayer/core';

/**
 * 严格匹配搜索（防翻唱）：歌词/封面失效兜底的统一入口。
 * 摄取端点搜索一次返回 url + lrc + cover，命中结果三件套齐全；
 * 各层（播放补歌词、播放器歌词兜底、列表封面重载）共用同一动作，
 * 避免每个页面各写一份"搜索 + 匹配"逻辑。
 * 搜索有缓存，同一首歌重复兜底不重复请求。
 */
export async function searchStrictMatch(song: Song): Promise<Song | null> {
  if (!song.name) return null;
  const res = await musicApi.searchSongs(`${song.name} ${song.artist}`, 1, song.sourceType);
  const match = findBestMatch({ name: song.name, artist: song.artist }, res);
  return (match?.song as Song) || null;
}
