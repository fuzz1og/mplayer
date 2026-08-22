import { musicApi, findExactMatch, stripSourceIdPrefix } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

/**
 * 严格匹配搜索（防翻唱）：歌词/封面失效兜底的统一入口。
 * 先按源站 ID 识别（链接过期但 ID 不过期，一次拿 url+lrc+cover，无匹配问题）；
 * ID 失败再按名字搜索 + 严格匹配。未匹配时打诊断日志（候选摘要）。
 * 搜索有缓存，同一首歌重复兜底不重复请求。
 */
export async function searchStrictMatch(song: Song): Promise<Song | null> {
  if (!song.name) return null;
  // ID 优先：收藏/歌单缓存的歌 ID 是源站真实 ID，不会过期
  const baseId = song.id ? stripSourceIdPrefix(song.id) : '';
  if (baseId) {
    const byId = await musicApi.searchSongById(baseId, song.sourceType);
    if (byId) return byId;
  }
  // 路由搜索（直连 + tier3 兜底）：自建 API 已退役，旧 searchSongs 恒空，
  // 歌词/封面兜底必须走 routed 才能拿到候选
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
