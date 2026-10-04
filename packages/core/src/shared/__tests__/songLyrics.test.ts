import { describe, expect, it } from 'vitest';
import { planLyricsFetch } from '../songLyrics.js';
import type { Song } from '../../types/index.js';

/**
 * 取词决策单点（#189 / ADR 2026-10-04）：播放与下载侧车共用同一份决策。
 * 这里锁的是**优先级**——存量内联 > lrc URL > 按 ID 直取 > none，
 * 顺序错了会分别导致「存量文本被当 URL 去拉」或「直取源白搜一次」。
 */
function song(overrides: Partial<Pick<Song, 'sourceType' | 'id' | 'lrc'>>) {
  return { sourceType: 'qq', id: '1', lrc: '', ...overrides } as Pick<Song, 'sourceType' | 'id' | 'lrc'>;
}

describe('planLyricsFetch', () => {
  it('存量内联文本优先于一切（网易 #409 之前的持久化数据）', () => {
    expect(planLyricsFetch(song({ sourceType: 'netease', lrc: '[00:01.00]词' }))).toEqual({
      kind: 'inline',
      text: '[00:01.00]词',
    });
  });

  it('非直取源的 lrc 是取词 URL', () => {
    expect(planLyricsFetch(song({ sourceType: 'qq', lrc: 'http://example.com/a.lrc' }))).toEqual({
      kind: 'url',
      url: 'http://example.com/a.lrc',
    });
  });

  it('网易/汽水 lrc 恒空 → 按源内 ID 直取，且区分两个源', () => {
    expect(planLyricsFetch(song({ sourceType: 'netease', lrc: '' }))).toEqual({
      kind: 'songid',
      source: 'netease',
      id: '1',
    });
    expect(planLyricsFetch(song({ sourceType: 'soda', lrc: '   ' }))).toEqual({
      kind: 'songid',
      source: 'soda',
      id: '1',
    });
  });

  it('非直取源且 lrc 为空 → none（是否搜索补全由调用方决定）', () => {
    expect(planLyricsFetch(song({ sourceType: 'kugou', lrc: '' }))).toEqual({ kind: 'none' });
  });

  it('网易存量内联（非 http）走 inline，不会退化成白搜', () => {
    const plan = planLyricsFetch(song({ sourceType: 'netease', lrc: 'plain text' }));
    expect(plan.kind).toBe('inline');
  });
});
