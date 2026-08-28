import { musicApi, findExactMatch } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

/**
 * 严格匹配搜索（防翻唱）：歌词/封面失效兜底的统一入口。
 * 按名字搜索（路由链：直连 + tier3 兜底）+ 严格匹配。未匹配时打诊断日志
 * （候选摘要）。搜索有缓存，同一首歌重复兜底不重复请求。
 */
export async function searchStrictMatch(song: Song): Promise<Song | null> {
  if (!song.name) return null;
  const res = await musicApi.searchSongsRouted(`${song.name} ${song.artist}`, 1, song.sourceType);
  const hit = (findExactMatch({ name: song.name, artist: song.artist }, res) as Song) || null;
  if (!hit) {
    const summary = res.slice(0, 5).map((c) => `《${c.name}》${c.artist}`).join(' | ');
    useLogsStore.getState().addLog(
      'warn',
      `资源搜索未匹配: 《${song.name}》${song.artist} ${song.sourceType} (候选${res.length}首: ${summary || '空'})`
    );
  }
  return hit;
}
