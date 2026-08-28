import type { Song, SourceKey } from '../types/index.js';
import type { ToplistGroup } from './sourceRouter.js';

/**
 * 内容聚合统一入口——排行榜聚合（#278 P2，Q7 决策：不接新消费方）。
 *
 * 从桌面 chartAggregator（src/main/services）提炼的纯聚合内核：
 * 输入 = 各源榜单歌组（ToplistGroup，rank 由索引推导），输出 = 跨源归一合并后的
 * 聚合歌曲组（分数降序）。纯函数零 I/O、零缓存——宿主自管缓存与并发拉取。
 *
 * 桌面 chartAggregator 已接本内核（#279），三源榜单腿走 `getDirectClient(source).getToplists()`。
 */

/** 未上榜源的默认排名（1/51 权重，与桌面 chartAggregator 语义一致）。 */
export const CHART_DEFAULT_MISS = 51;

/** 同组选优的默认源序（netease > qq > kugou，其余源按传入顺序排后）。 */
const DEFAULT_SOURCE_ORDER: SourceKey[] = ['netease', 'qq', 'kugou'];

/**
 * 归一化歌曲匹配键（跨源模糊匹配用）：
 * - 歌名：小写、去空格、去括号内容、只保留中文/英文/数字；
 * - 歌手：小写、去空格、去点号。
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

/** 聚合排名分数：score = Σ(1/rank)，未上榜源 = 1/CHART_DEFAULT_MISS。 */
function aggregateScore(ranks: Partial<Record<SourceKey, number>>): number {
  let score = 0;
  for (const rank of Object.values(ranks)) {
    score += rank ? 1 / rank : 1 / CHART_DEFAULT_MISS;
  }
  return score;
}

/** 归一化后的榜单歌曲（含索引推导的排名）。 */
interface RankedSong {
  song: Song;
  source: SourceKey;
  rank: number;
}

/**
 * 同组选优：完整版优先（audioTag !== 'preview'）> 排名优先（min rank）> 源序。
 */
function pickBest(songs: RankedSong[], sourceOrder: SourceKey[]): RankedSong {
  return songs.reduce((best, current) => {
    const bestIsPreview = best.song.audioTag === 'preview';
    const currentIsPreview = current.song.audioTag === 'preview';
    if (bestIsPreview && !currentIsPreview) return current;
    if (!bestIsPreview && currentIsPreview) return best;
    if (current.rank < best.rank) return current;
    if (current.rank > best.rank) return best;
    return sourceOrder.indexOf(current.source) < sourceOrder.indexOf(best.source) ? current : best;
  });
}

/** 聚合后的歌曲组（跨源归一匹配结果）。 */
export interface AggregatedChartEntry {
  /** 归一化匹配键（name|artist） */
  key: string;
  name: string;
  artist: string;
  /** 组内各源命中的歌曲（bestSong 通常取其中之一） */
  songs: Song[];
  /** 源 → 该源内排名；未上榜源不出现在键里（由调用方决定缺省语义） */
  sourceRanks: Partial<Record<SourceKey, number>>;
  /** 聚合分数（越大越靠前） */
  score: number;
  /** 组内选优的代表歌曲 */
  bestSong: Song;
}

/**
 * 聚合多源榜单歌曲组。
 * @param entries 各源榜单（通常来自 `client.getToplists()`，rank 由索引推导）；
 *                单源多个榜组可拆成多条 entry 传入（如热歌榜 + 新歌榜分次聚合）。
 * @param sourceOrder 同组选优的源序，缺省 netease > qq > kugou > 其余按出现顺序。
 */
export function aggregateChartSongs(
  entries: { source: SourceKey; songs: Song[] }[],
  sourceOrder: SourceKey[] = DEFAULT_SOURCE_ORDER,
): AggregatedChartEntry[] {
  const order = [...sourceOrder, ...new Set(entries.map((e) => e.source))];

  // 展开为带排名的平铺列表（rank = 组内索引 + 1，#239）
  const ranked: RankedSong[] = [];
  for (const entry of entries) {
    entry.songs.forEach((song, i) => {
      ranked.push({ song, source: entry.source, rank: i + 1 });
    });
  }

  // 按归一化键分组
  const groupMap = new Map<string, { songs: RankedSong[]; sourceRanks: Partial<Record<SourceKey, number>>; order: SourceKey[] }>();
  for (const item of ranked) {
    const key = normalizeSongKey(item.song);
    const existing = groupMap.get(key);
    if (existing) {
      existing.songs.push(item);
      existing.sourceRanks[item.source] = item.rank;
      if (!existing.order.includes(item.source)) existing.order.push(item.source);
    } else {
      groupMap.set(key, {
        songs: [item],
        sourceRanks: { [item.source]: item.rank },
        order: [item.source],
      });
    }
  }

  // 构建聚合结果，按分数降序
  const groups: AggregatedChartEntry[] = [];
  for (const [key, { songs: groupSongs, sourceRanks, order: appearedOrder }] of groupMap) {
    const best = pickBest(groupSongs, [...order, ...appearedOrder]);
    groups.push({
      key,
      name: best.song.name,
      artist: best.song.artist,
      songs: groupSongs.map((s) => s.song),
      sourceRanks,
      score: aggregateScore(sourceRanks),
      bestSong: best.song,
    });
  }
  groups.sort((a, b) => b.score - a.score);
  return groups;
}

/** 便捷入口：直接聚合一组 ToplistGroup（榜单 id 形如 `${source}:${sourceId}`）。 */
export function aggregateToplistGroups(groups: ToplistGroup[]): AggregatedChartEntry[] {
  return aggregateChartSongs(
    groups.map((g) => ({
      source: g.id.slice(0, g.id.indexOf(':')) as SourceKey,
      songs: g.songs,
    }))
  );
}
