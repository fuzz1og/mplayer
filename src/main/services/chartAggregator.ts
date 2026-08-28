import type { Song, SourceKey, ToplistGroup } from '@mplayer/core';
import { aggregateChartSongs, cacheManager, getDirectClient } from '@mplayer/core';
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

export type ChartType = 'hot' | 'new';
export type SourceName = 'netease' | 'qq' | 'kugou';

/**
 * 多源排行榜聚合（#279 接 core 聚合内核）。
 *
 * 本模块瘦身为宿主壳：并行拉各源榜单（能力面 getToplists，一次取全组按榜型 id
 * 取歌）→ 交 core `aggregateChartSongs` 做归一合并 / Σ1/rank 计分 / 完整版优先
 * 选优 → 写进程内缓存。本地的归一化键/计分/选优实现已随内核统一删除；
 * 计分语义以内核为准（未上榜源不计入 sourceRanks，不再做 1/51 预填）。
 */

/** 各源各榜型的榜单 sourceId（与桌面私有路径时代一致；QQ 26/27 自 v8 topid，#279）。 */
const TOPLIST_IDS: Record<SourceName, Record<ChartType, number | string>> = {
  netease: { hot: 3778678, new: 3779629 },
  qq: { hot: 26, new: 27 },
  kugou: { hot: '8888', new: '74534' },
};

/** 从榜单组中按 id 取歌（ToplistGroup.id = `${source}:${sourceId}`）。 */
function pickToplistSongs(groups: ToplistGroup[], source: SourceName, sourceId: number | string): Song[] {
  return groups.find((g) => g.id === `${source}:${sourceId}`)?.songs ?? [];
}

/** 单源腿：能力面 getToplists 一次取全组，按榜型 id 取歌（rank 由内核按索引推导）。 */
async function fetchSourceToplist(
  type: ChartType,
  source: SourceName,
): Promise<{ source: SourceKey; songs: Song[] }> {
  const client = getDirectClient(source);
  if (!client?.getToplists) {
    throw new Error(`源 ${source} 未实现内容能力 getToplists`);
  }
  const groups = await client.getToplists();
  return { source, songs: pickToplistSongs(groups, source, TOPLIST_IDS[source][type]) };
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
