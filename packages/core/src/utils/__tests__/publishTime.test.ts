import { describe, it, expect } from 'vitest';
import { normalizePublishTime } from '../publishTime.js';

/**
 * 发行时间归一（#407）——接缝 = 纯函数。
 * 期望值一律写**独立字面量**（不是把实现里的 Date.UTC 再算一遍），
 * 口径 = 各源原始格式的实测样本（见 issue #407 §8 的格式矩阵）。
 */
describe('normalizePublishTime：各源发行时间 → epoch ms 字符串', () => {
  it('网易：数字毫秒原样保留', () => {
    expect(normalizePublishTime(1744646400000)).toBe('1744646400000');
  });

  it('汽水：数字秒 → 升为毫秒', () => {
    expect(normalizePublishTime(1744646400)).toBe('1744646400000');
  });

  it('数字串（秒/毫秒两种量级）与数字同口径', () => {
    expect(normalizePublishTime('1744646400000')).toBe('1744646400000');
    expect(normalizePublishTime('1744646400')).toBe('1744646400000');
  });

  it('QQ：2026-07-26 日期串 → 该日 UTC 零点', () => {
    expect(normalizePublishTime('2026-07-26')).toBe('1785024000000');
  });

  it('酷狗：2026-07-04 00:00:00 日期时间串', () => {
    expect(normalizePublishTime('2026-07-04 00:00:00')).toBe('1783123200000');
  });

  it('千千：斜杠日期串同口径', () => {
    expect(normalizePublishTime('2026/07/26')).toBe('1785024000000');
  });

  it('1997 年（陶喆 David Tao）不被当成秒级数字', () => {
    expect(normalizePublishTime('1997-12-05')).toBe('881280000000');
  });

  it('缺失 / 不可解析一律归一为空串（消费方按「无」渲染）', () => {
    expect(normalizePublishTime(undefined)).toBe('');
    expect(normalizePublishTime(null)).toBe('');
    expect(normalizePublishTime('')).toBe('');
    expect(normalizePublishTime(0)).toBe('');
    expect(normalizePublishTime('abc')).toBe('');
    expect(normalizePublishTime({})).toBe('');
    expect(normalizePublishTime('0000-00-00')).toBe('');
  });
});
