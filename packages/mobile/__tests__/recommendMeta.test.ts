import { describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';
import { formatBatchMeta } from '../components/recommendMeta';

function song(duration: number): Song {
  return {
    id: String(duration),
    name: 'test',
    artist: 'test',
    album: '',
    duration,
    sourceType: 'netease',
    url: '',
    cover: '',
    lrc: '',
  };
}

describe('每日推荐卡头副标题', () => {
  it('按总时长四舍五入到分钟', () => {
    expect(formatBatchMeta([song(295), song(257), song(320), song(263), song(282)]))
      .toBe('5 首 · 24 分钟');
  });

  it('时长缺失或为 0 时只显示首数', () => {
    expect(formatBatchMeta([song(0), song(Number.NaN)])).toBe('2 首');
  });

  it('空批次显示 0 首', () => {
    expect(formatBatchMeta([])).toBe('0 首');
  });
});
