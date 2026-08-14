import { describe, expect, it } from 'vitest';
import { estimateDownloadProgress } from '../progress.js';

describe('estimateDownloadProgress 进度估算', () => {
  it('Content-Length 已知：按已收字节/总量计算，限幅 0..100', () => {
    expect(estimateDownloadProgress({ loaded: 50, total: 100 })).toBe(50);
    expect(estimateDownloadProgress({ loaded: 100, total: 100 })).toBe(100);
    expect(estimateDownloadProgress({ loaded: 0, total: 100 })).toBe(0);
    // 超过总量（chunked 等）限幅到 100 以内
    expect(estimateDownloadProgress({ loaded: 999, total: 100 })).toBe(100);
  });

  it('未知总量（total=null/-1）：仍按已收字节数给出单调进度，且永不报 100%', () => {
    // 关键：不再卡在 0%
    expect(estimateDownloadProgress({ loaded: 0, total: null })).toBe(0);
    expect(estimateDownloadProgress({ loaded: 1024, total: null })).toBeGreaterThan(0);
    expect(estimateDownloadProgress({ loaded: 5 * 1024 * 1024, total: null })).toBeGreaterThan(0);
    // 未知总量不能谎称完成
    expect(estimateDownloadProgress({ loaded: Number.MAX_SAFE_INTEGER, total: null })).toBeLessThan(100);
  });

  it('未知总量进度随已收字节单调不减', () => {
    const p1 = estimateDownloadProgress({ loaded: 10_000, total: null });
    const p2 = estimateDownloadProgress({ loaded: 20_000, total: null });
    const p3 = estimateDownloadProgress({ loaded: 100_000, total: null });
    expect(p2).toBeGreaterThanOrEqual(p1);
    expect(p3).toBeGreaterThanOrEqual(p2);
  });

  it('total 为 -1（expo onProgress 约定）与 null 等价', () => {
    const asNull = estimateDownloadProgress({ loaded: 2048, total: null });
    const asMinus1 = estimateDownloadProgress({ loaded: 2048, total: -1 });
    expect(asMinus1).toBe(asNull);
  });
});
