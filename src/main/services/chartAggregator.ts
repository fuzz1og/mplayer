import type { Song, SourceKey, ToplistGroup } from '@mplayer/core';
import { getDirectClient } from '@mplayer/core';
import { musicApi } from '../api/musicApi';
import { getKugouRank, getKugouNewSongs } from '../api/kugouApi';
import { cacheManager } from '@mplayer/core';
import { CHART_CACHE_TTL } from '../../shared/chart';
import type {
  AggregatedSongGroup,
  AggregatedChartResult,
  SourceRank,
} from '../../shared/chart';
export type {
  AggregatedSongGroup,
  AggregatedChartResult,
  SourceRank,
} from '../../shared/chart';

export type ChartType = 'hot' | 'new';
export type SourceName = 'netease' | 'qq' | 'kugou';

const DEFAULT_MISS = 51; // 未上榜源的默认排名

/**
 * 归一化歌曲匹配键（模糊匹配用）
 * - 歌名：小写、去空格、去括号内容、只保留中文/英文/数字
 * - 歌手：小写、去空格、去点号
 */
export function normalizeSongKey(song: { name: string; artist: string }): string {
  const name = song.name
    .toLowerCase()
    .replace(/[（(].*?[)）]/g, '') // 去掉括号内容
    .replace(/\s+/g, '') // 去掉空格
    .replace(/[^一-龥a-z0-9]/gi, ''); // 只保留中文/英文/数字

  const artist = song.artist
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•]/g, '');

  return `${name}|${artist}`;
}

/** 归一化后的歌曲（用于聚合） */
interface NormalizedSong {
  name: string;
  artist: string;
  cover: string;
  rank: number;
  sourceType: SourceKey;
  song: Song;
}

/**
 * 计算聚合排名分数
 * score = Σ(1/rank)，未上榜源 = 1/51
 */
function aggregateRank(ranks: SourceRank): number {
  let score = 0;
  for (const rank of Object.values(ranks)) {
    score += rank ? 1 / rank : 1 / DEFAULT_MISS;
  }
  return score;
}

function createSourceRanks(sources: SourceName[]): SourceRank {
  return Object.fromEntries(sources.map(source => [source, DEFAULT_MISS])) as SourceRank;
}

/** 网易榜单 playlistId（与门面时代一致，#278 迁能力面 getToplists）。 */
const NETEASE_TOPLIST_ID: Record<ChartType, number> = { hot: 3778678, new: 3779629 };

/** 从榜单组中按 id 取歌（ToplistGroup.id = `${source}:${sourceId}`）。 */
function pickToplistSongs(groups: ToplistGroup[], source: SourceName, sourceId: number): Song[] {
  return groups.find((g) => g.id === `${source}:${sourceId}`)?.songs ?? [];
}

/**
 * 获取指定源+类型的 fetcher
 */
function getSourceFetcher(type: ChartType, source: SourceName): () => Promise<NormalizedSong[]> {
  if (source === 'netease') {
    return async () => {
      // 网易榜单走能力面 getToplists（一次取全组），rank 由索引推导（#239）
      const groups = await getDirectClient('netease')!.getToplists!();
      return pickToplistSongs(groups, 'netease', NETEASE_TOPLIST_ID[type]).map((song, i) => ({
        name: song.name,
        artist: song.artist,
        cover: song.cover,
        rank: i + 1,
        sourceType: 'netease' as SourceKey,
        song,
      }));
    };
  }

  if (source === 'qq') {
    return async () => {
      const songs = type === 'hot' ? await musicApi.getQQHotlist() : await musicApi.getQQNewSongList();
      return songs.map(s => ({
        name: s.name,
        artist: s.artists,
        cover: s.cover,
        rank: s.rank,
        sourceType: 'qq' as SourceKey,
        song: {
          id: s.id,
          name: s.name,
          artist: s.artists,
          album: s.album,
          url: '',
          cover: s.cover,
          lrc: '',
          duration: 0,
          sourceType: 'qq',
        },
      }));
    };
  }

  // kugou
  const kugouFetcher = type === 'hot'
    ? () => getKugouRank('8888', 50)
    : () => getKugouNewSongs();
  return async () => {
    const songs = await kugouFetcher();
    return songs.map((s, i) => ({
      name: s.name,
      artist: s.artist,
      cover: s.cover,
      rank: i + 1, // Kugou 返回无 rank 字段，用索引
      sourceType: 'kugou' as SourceKey,
      song: s,
    }));
  };
}

/**
 * 聚合多源排行榜
 * @param type 'hot' | 'new'
 * @param sources 要聚合的源列表
 */

export async function getAggregatedChart(
  type: ChartType,
  sources: SourceName[],
): Promise<AggregatedChartResult> {
  const cacheKey = `chart_${type}_${[...sources].sort().join('_')}`;
  const cached = cacheManager.get<AggregatedChartResult>(cacheKey);
  if (cached) return cached;

  // 并行获取所有源
  const fetchTasks = sources.map(source => getSourceFetcher(type, source));
  const results = await Promise.allSettled(fetchTasks.map(fn => fn()));

  // 收集所有歌曲
  const allSongs: NormalizedSong[] = [];
  const fulfilledSources: SourceName[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      fulfilledSources.push(sources[i]);
      allSongs.push(...result.value);
    }
  }

  // 按归一化键分组
  const groupMap = new Map<string, { songs: NormalizedSong[]; sourceRanks: SourceRank }>();

  for (const song of allSongs) {
    const key = normalizeSongKey(song);
    const existing = groupMap.get(key);
    if (existing) {
      existing.songs.push(song);
      existing.sourceRanks[song.sourceType as keyof SourceRank] = song.rank;
    } else {
      const sourceRanks = createSourceRanks(fulfilledSources);
      sourceRanks[song.sourceType as keyof SourceRank] = song.rank;
      groupMap.set(key, {
        songs: [song],
        sourceRanks,
      });
    }
  }

  // 构建聚合结果
  const groups: AggregatedSongGroup[] = [];
  for (const [key, { songs: groupSongs, sourceRanks }] of groupMap) {
    // 同组选优：完整版优先 > 最好排名 > 默认源序
    const bestSong = pickBestSong(groupSongs);
    const score = aggregateRank(sourceRanks);

    groups.push({
      key,
      name: bestSong.name,
      artist: bestSong.artist,
      songs: groupSongs.map(s => s.song),
      sourceRanks,
      score,
      bestSong: bestSong.song,
    });
  }

  // 按分数降序排列
  groups.sort((a, b) => b.score - a.score);

  const result: AggregatedChartResult = {
    songs: groups,
    total: groups.length,
  };

  cacheManager.set(cacheKey, result, CHART_CACHE_TTL);
  return result;
}

/**
 * 同组选优策略：
 * 1. 完整版优先 (audioTag !== 'preview')
 * 2. 排名优先 (min rank)
 * 3. 默认源序 (netease > qq > kugou)
 */
function pickBestSong(songs: NormalizedSong[]): NormalizedSong {
  const sourceOrder: SourceKey[] = ['netease', 'qq', 'kugou'];
  return songs.reduce((best, current) => {
    // 完整版优先
    const bestIsPreview = best.song.audioTag === 'preview';
    const currentIsPreview = current.song.audioTag === 'preview';
    if (bestIsPreview && !currentIsPreview) return current;
    if (!bestIsPreview && currentIsPreview) return best;

    // 排名优先
    if (current.rank < best.rank) return current;
    if (current.rank > best.rank) return best;

    // 默认源序
    const bestIdx = sourceOrder.indexOf(best.sourceType);
    const currentIdx = sourceOrder.indexOf(current.sourceType);
    return currentIdx < bestIdx ? current : best;
  });
}
