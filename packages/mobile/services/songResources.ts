import { musicApi, searchPlayableMatch, isLegacyDeadUrl, refreshSongResource } from '@mplayer/core';
import type { PlayableResource, Song } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';
import { getCachedResource, setCachedResource } from './cacheService';

/**
 * 严格搜索候选（core 刷新编排的搜索端口）：按名字走路由搜索（直连 + tier3 兜底），
 * 返回原始候选；精确匹配守卫只在 core（utils/songMatcher.findExactMatch）——
 * 平台侧不自己判匹配，正是「热榜第 6 份漏守卫」的通用修复。
 */
async function searchStrictCandidates(song: Song): Promise<Song[]> {
  if (!song.name) return [];
  return musicApi.searchSongsRouted(`${song.name} ${song.artist}`, 1, song.sourceType);
}

/**
 * 严格匹配搜索（防翻唱）：歌词/封面失效兜底的统一入口。按名字搜索（路由链：直连 + tier3 兜底）+ 严格匹配，未匹配时打诊断
 * 日志；搜索有缓存，同一首歌重复兜底不重复请求。判据与搜索端口已上收 core（`shared/playableVersion.searchPlayableMatch`），
 * 与桌面共用；本函数只保留「返回候选本体」这个移动端特有需要（多处同时回填 url 与 lrc），对外签名不变。
 */
export async function searchStrictMatch(song: Song): Promise<Song | null> {
  return searchPlayableMatch(song, {
    search: searchStrictCandidates,
    log: (level, message) => useLogsStore.getState().addLog(level, message),
  });
}

/**
 * 返回 null 的调用方约定见 core 接口不变量：**不得用 null 覆盖本地已有的有效 url**。
 */
export async function refreshPlayableResource(song: Song): Promise<PlayableResource | null> {
  return refreshSongResource(song, {
    readCache: getCachedResource,
    writeCache: setCachedResource,
    search: searchStrictCandidates,
    isDeadUrl: isLegacyDeadUrl,
    log: (level, message) => useLogsStore.getState().addLog(level, message),
  });
}
