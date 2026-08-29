import type { Song, SourceKey, ToplistSourceKey, ChartKind } from '@mplayer/core';
import { aggregateChartSongs, cacheManager, getToplistSongs, TOPLIST_SOURCE_IDS } from '@mplayer/core';
import { CHART_CACHE_TTL } from '../../shared/chart';
import type {
  AggregatedSongGroup,
  AggregatedChartResult,
} from '../../shared/chart';
export type {
  AggregatedSongGroup,
  AggregatedChartResult,
  SourceRank,
} from '../../shared/chart';

export type ChartType = ChartKind;
export type SourceName = ToplistSourceKey;

/**
 * 多源排行榜聚合（#279 接 core 聚合内核）。
 *
 * 本模块瘦身为宿主壳：并行拉各源榜单（能力面 getToplists，一次取全组按榜型 id
 * 取歌）→ 交 core `aggregateChartSongs` 做归一合并 / Σ1/rank 计分 / 完整版优先
 * 选优 → 写进程内缓存。本地的归一化键/计分/选优实现已随内核统一删除；
 * 计分语义以内核为准（未上榜源不计入 sourceRanks，不再做 1/51 预填）。
 * 榜单 id 契约与取组已下沉 core `getToplistSongs`（#286）。
 */

/** 单源腿：经 core getToplistSongs（能力面 getToplists + 按 id 取组，无客户端抛错）。 */
async function fetchSourceToplist(
  type: ChartType,
  source: SourceName,
): Promise<{ source: SourceKey; songs: Song[] }> {
  return { source, songs: await getToplistSongs(source, TOPLIST_SOURCE_IDS[source][type]) };
}

/**
 * 聚合多源排行榜
 * @param type 'hot' | 'new'
 * @param sources 要聚合的源列表（失败的源整体跳过，不进聚合）
 */
export async function getAggregatedChart(
  type: ChartType,
  sources: SourceName[],
): Promise<AggregatedChartResult> {
  const cacheKey = `chart_${type}_${[...sources].sort().join('_')}`;
  const cached = cacheManager.get<AggregatedChartResult>(cacheKey);
  if (cached) return cached;

  // 并行获取所有源
  const settled = await Promise.allSettled(sources.map(source => fetchSourceToplist(type, source)));
  const entries = settled
    .filter((r): r is PromiseFulfilledResult<{ source: SourceKey; songs: Song[] }> => r.status === 'fulfilled')
    .map(r => r.value);

  // 聚合统一入口（core 内核）：归一化合并 + Σ1/rank 计分 + 同组选优 + 分数降序
  const aggregated = aggregateChartSongs(entries);

  const groups: AggregatedSongGroup[] = aggregated.map(e => ({
    key: e.key,
    name: e.name,
    artist: e.artist,
    songs: e.songs,
    sourceRanks: e.sourceRanks,
    score: e.score,
    bestSong: e.bestSong,
  }));

  const result: AggregatedChartResult = {
    songs: groups,
    total: groups.length,
  };

  cacheManager.set(cacheKey, result, CHART_CACHE_TTL);
  return result;
}
