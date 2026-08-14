import type { Song, SongGroup } from '@mplayer/core';

export const CHART_CACHE_TTL = 30 * 60 * 1000;

/** 聚合后的歌曲组（跨源匹配） */
export interface AggregatedSongGroup extends SongGroup {
  sourceRanks: SourceRank;
  score: number;
  bestSong: Song;
}

export interface SourceRank {
  netease?: number;
  qq?: number;
  kugou?: number;
}

export interface AggregatedChartResult {
  songs: AggregatedSongGroup[];
  total: number;
}
