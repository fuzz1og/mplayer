import { musicApi, findBestMatch } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

/**
 * 严格匹配搜索（防翻唱）：歌词/封面失效兜底的统一入口。
 * 摄取端点搜索一次返回 url + lrc + cover，命中结果三件套齐全；
 * 各层（播放补歌词、播放器歌词兜底、列表封面重载）共用同一动作，
 * 避免每个页面各写一份"搜索 + 匹配"逻辑。
 * 搜索有缓存，同一首歌重复兜底不重复请求。
 * 未匹配时打诊断日志（候选摘要），识别失败链路可见。
 */
export async function searchStrictMatch(song: Song): Promise<Song | null> {
  if (!song.name) return null;
  const res = await musicApi.searchSongs(`${song.name} ${song.artist}`, 1, song.sourceType);
  const match = findBestMatch({ name: song.name, artist: song.artist }, res);
  const hit = (match?.song as Song) || null;
  if (!hit) {
    const summary = res.slice(0, 5).map((c) => `《${c.name}》${c.artist}`).join(' | ');
    useLogsStore.getState().addLog(
      'warn',
      `资源搜索未匹配: 《${song.name}》${song.artist} ${song.sourceType} (候选${res.length}首: ${summary || '空'})`
    );
  }
  return hit;
}
