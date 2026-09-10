import { describe, expect, it } from 'vitest';
import { identityKey, identityKeyFrom, rawSongId } from '../songIdentity.js';
import { stripSourceIdPrefix } from '../sourceIdPrefix.js';

describe('rawSongId（去源前缀的真实 ID）', () => {
  it('裸 id 原样返回', () => {
    expect(rawSongId('123')).toBe('123');
  });

  it('单层源前缀剥离', () => {
    expect(rawSongId('kuwo:456')).toBe('456');
  });

  it('多层嵌套前缀循环剥离（kuwo:kugou:123 → 123）', () => {
    expect(rawSongId('kuwo:kugou:123')).toBe('123');
    expect(rawSongId('qq:netease:kuwo:9')).toBe('9');
  });

  it('空值归一为空串', () => {
    expect(rawSongId(undefined)).toBe('');
    expect(rawSongId(null)).toBe('');
  });
});

describe('migu 前缀补齐（#307 契约缺口）', () => {
  it('stripSourceIdPrefix 剥离 migu 前缀（此前漏配 → migu:migu:123）', () => {
    expect(stripSourceIdPrefix('migu:123')).toBe('123');
    expect(stripSourceIdPrefix('migu:kugou:123')).toBe('123');
  });

  it('裸 id 与带 migu 前缀 id 收敛为同一身份键（直连搜索 vs 换源后）', () => {
    expect(identityKeyFrom('migu', '123')).toBe('migu:123');
    expect(identityKeyFrom('migu', 'migu:123')).toBe('migu:123');
    expect(identityKeyFrom('migu', '123')).toBe(identityKeyFrom('migu', 'migu:123'));
  });

  it('多层嵌套 migu:kugou:1 收敛为最外层源 migu', () => {
    expect(rawSongId('migu:kugou:1')).toBe('1');
    expect(identityKeyFrom('kugou', 'migu:kugou:1')).toBe('migu:1');
    expect(identityKeyFrom('migu', 'migu:kugou:1')).toBe('migu:1');
  });
});

describe('identityKeyFrom / identityKey（歌曲身份键）', () => {
  it('裸 id + sourceType → source:rawId', () => {
    expect(identityKeyFrom('netease', '123')).toBe('netease:123');
  });

  it('带前缀 id 与裸 id 收敛为同一键（换源前后同一首歌）', () => {
    expect(identityKeyFrom('netease', 'netease:123')).toBe('netease:123');
    expect(identityKeyFrom('netease', 'netease:123')).toBe(identityKeyFrom('netease', '123'));
  });

  it('多层嵌套前缀收敛为最外层源（id 前缀优先于 sourceType 字段）', () => {
    expect(identityKeyFrom('kugou', 'kuwo:kugou:123')).toBe('kuwo:123');
    expect(identityKeyFrom('kuwo', 'kuwo:kugou:123')).toBe('kuwo:123');
  });

  it('同一 rawId 不同源必不相等', () => {
    expect(identityKeyFrom('netease', '123')).not.toBe(identityKeyFrom('qq', '123'));
    expect(identityKeyFrom('netease', 'netease:123')).not.toBe(identityKeyFrom('qq', 'qq:123'));
  });

  it('sourceType 缺失时退回 id 自带前缀', () => {
    expect(identityKeyFrom(undefined, 'kuwo:456')).toBe('kuwo:456');
    expect(identityKeyFrom(null, 'kuwo:kugou:123')).toBe('kuwo:123');
  });

  it('sourceType 与 id 前缀都缺失时落在空源命名空间，自成一类', () => {
    expect(identityKeyFrom(undefined, '123')).toBe(':123');
    expect(identityKeyFrom('', '123')).toBe(':123');
    expect(identityKeyFrom(undefined, '123')).not.toBe(identityKeyFrom('netease', '123'));
  });

  it('空 id 保留源命名空间（不同源仍不相等）', () => {
    expect(identityKeyFrom('netease', '')).toBe('netease:');
    expect(identityKeyFrom('netease', '')).not.toBe(identityKeyFrom('qq', ''));
  });

  it('identityKey(song) 与 identityKeyFrom 同源', () => {
    const swapped = { id: 'kuwo:9', sourceType: 'kuwo' as const };
    expect(identityKey(swapped)).toBe('kuwo:9');
    expect(identityKey({ id: '9', sourceType: 'kuwo' })).toBe(identityKey(swapped));
  });
});
