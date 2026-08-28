import { describe, expect, it } from 'vitest';
import { aggregateChartSongs, aggregateToplistGroups, normalizeSongKey, CHART_DEFAULT_MISS } from '../chartAggregate.js';
import type { Song } from '../../types/index.js';

/**
 * 内容聚合统一入口测试（#278 P2）：纯函数，语义与桌面 chartAggregator 对齐
 * （归一化合并、Σ1/rank 计分、未上榜 1/51、完整版优先选优）。
 */

const song = (over: Partial<Song> & { id: string; name: string }): Song => ({
  artist: '歌手A',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 0,
  sourceType: 'netease',
  ...over,
});

describe('aggregateChartSongs（#278 排行榜聚合内核）', () => {
  it('normalizeSongKey：去括号/空格/点号归一，跨源同名同歌手合并', () => {
    expect(normalizeSongKey({ name: '稻香（Live）', artist: '周 杰·伦' })).toBe(
      normalizeSongKey({ name: '稻香', artist: '周杰伦' })
    );
  });

  it('跨源合并同名歌，rank 由索引推导，score = Σ1/rank，未上榜源不计入 sourceRanks', () => {
    const result = aggregateChartSongs([
      { source: 'netease', songs: [song({ id: '1', name: '歌一' }), song({ id: '2', name: '歌二' })] },
      { source: 'qq', songs: [song({ id: 'q1', name: '歌一', sourceType: 'qq' })] },
    ]);
    expect(result).toHaveLength(2);
    const merged = result.find((g) => g.name === '歌一')!;
    expect(merged.sourceRanks).toEqual({ netease: 1, qq: 1 });
    expect(merged.score).toBeCloseTo(2);
    // 未上榜源（kugou 未传）不出现在 sourceRanks——调用方决定缺省语义
    expect(Object.keys(merged.sourceRanks)).not.toContain('kugou');
  });

  it('同组选优：完整版优先于试听版，其次看排名', () => {
    const result = aggregateChartSongs([
      { source: 'netease', songs: [song({ id: 'n1', name: '歌X', audioTag: 'preview' })] },
      { source: 'qq', songs: [song({ id: 'q1', name: '歌X', sourceType: 'qq' })] },
    ]);
    expect(result[0].bestSong.id).toBe('q1'); // qq 完整版胜出（虽然同为 rank 1）
    expect(result[0].bestSong.sourceType).toBe('qq');
  });

  it('结果按分数降序；单源独占歌保持源内索引排名', () => {
    const result = aggregateChartSongs([
      { source: 'netease', songs: [song({ id: '1', name: '热歌' })] },
      { source: 'qq', songs: [song({ id: 'q1', name: '另一首', sourceType: 'qq' }), song({ id: 'q2', name: '歌X', sourceType: 'qq' })] },
      { source: 'kugou', songs: [song({ id: 'k1', name: '歌X', sourceType: 'kugou' })] },
    ]);
    // 歌X：qq rank 2 + kugou rank 1 > 热歌 1 > 另一首 1 → 分数并列时保持稳定序
    expect(result[0].name).toBe('歌X');
    expect(result[0].score).toBeCloseTo(1 / 2 + 1);
    expect(result.map((g) => g.name)).toContain('热歌');
    expect(result.map((g) => g.name)).toContain('另一首');
    expect(CHART_DEFAULT_MISS).toBe(51);
  });

  it('aggregateToplistGroups：从 ToplistGroup.id 解析 source（netease:3778678）', () => {
    const result = aggregateToplistGroups([
      { id: 'netease:3778678', name: '热歌榜', songs: [song({ id: '1', name: '歌一' })] },
      { id: 'kugou:8888', name: '热歌榜', songs: [song({ id: 'k1', name: '歌一', sourceType: 'kugou' })] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].sourceRanks).toEqual({ netease: 1, kugou: 1 });
  });
});
