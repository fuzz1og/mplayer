import { describe, expect, it, beforeEach } from 'vitest';
import { COVER_ERROR_MAX_PER_SCOPE, logCoverError, resetCoverDiagnostics } from '../services/coverDiagnostics';
import { useLogsStore } from '../stores/logsStore';

const coverLogs = () => useLogsStore.getState().entries.filter((e) => e.message.includes('[cover]'));

/**
 * 「封面没出来」过去是完全不可观测的（全仓 10 处 Image 只有 3 处挂 onError，且都不打日志）。
 * 这里锁的是**不刷屏**这条策略：同一张图只报一次、每个 scope 有明细上限。
 */
describe('封面失败埋点（#465 后续）', () => {
  beforeEach(() => {
    resetCoverDiagnostics();
    useLogsStore.getState().clearLogs();
  });

  it('同一 (scope,url) 只报一次（长列表逐帧重渲染不会刷屏）', () => {
    logCoverError('album-grid', 'https://x/a.jpg');
    logCoverError('album-grid', 'https://x/a.jpg');
    logCoverError('album-grid', 'https://x/a.jpg');
    expect(coverLogs()).toHaveLength(1);
  });

  it('不同 url / 不同 scope 各自成条', () => {
    logCoverError('album-grid', 'https://x/a.jpg');
    logCoverError('album-grid', 'https://x/b.jpg');
    logCoverError('song-row', 'https://x/a.jpg');
    expect(coverLogs()).toHaveLength(3);
  });

  it('空 url 单独成条且日志里可辨认（数据缺失 ≠ 请求失败）', () => {
    logCoverError('hero', undefined);
    logCoverError('hero', '');
    const entries = coverLogs();
    expect(entries).toHaveLength(1); // undefined 与 '' 视为同一条
    expect(entries[0]!.message).toContain('(空 url)');
  });

  it('每个 scope 明细有上限，溢出只补一行摘要（整屏失败也不淹没日志环）', () => {
    for (let i = 0; i < COVER_ERROR_MAX_PER_SCOPE + 5; i++) logCoverError('album-grid', `https://x/${i}.jpg`);
    const entries = coverLogs();
    expect(entries).toHaveLength(COVER_ERROR_MAX_PER_SCOPE + 1);
    expect(entries[entries.length - 1]!.message).toContain('上限');
  });

  it('上限是 per-scope 的（一个 scope 溢出不影响另一个）', () => {
    for (let i = 0; i < COVER_ERROR_MAX_PER_SCOPE + 3; i++) logCoverError('album-grid', `https://x/${i}.jpg`);
    logCoverError('hero', 'https://x/hero.jpg');
    expect(coverLogs().some((e) => e.message.includes('hero'))).toBe(true);
  });
});
