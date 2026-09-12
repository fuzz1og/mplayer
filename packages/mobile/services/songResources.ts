import { musicApi, findExactMatch, isLegacyDeadUrl, refreshSongResource } from '@mplayer/core';
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
 * 严格匹配搜索（防翻唱）：歌词/封面失效兜底的统一入口。
 * 按名字搜索（路由链：直连 + tier3 兜底）+ 严格匹配。未匹配时打诊断日志
 * （候选摘要）。搜索有缓存，同一首歌重复兜底不重复请求。
 */
export async function searchStrictMatch(song: Song): Promise<Song | null> {
  if (!song.name) return null;
  const res = await searchStrictCandidates(song);
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

/**
 * 移动端「可播资源刷新」适配器（ADR-0012 决策 3）：把 core 纯编排
 * （取缓存 → 旧签名死链判定 → 精确匹配搜索 → 写缓存）接到移动端口——
 * 读/写 = cacheService（身份键 + 资源值），搜索 = 路由严格搜索，
 * 死链判定 = core isLegacyDeadUrl，诊断走 logsStore。
 *
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
