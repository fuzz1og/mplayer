import { describe, expect, it } from 'vitest';
import { coverGlyph, pickFallbackPalette, seedIndex } from '../components/coverFallbackSeed';

/**
 * 兜底封面的**确定性**是它的全部价值所在（同一实体每次同一张脸，刷新不跳），
 * 所以这里锁死哈希与取色，而不是锁具体色值（调色板允许调整）。
 */
describe('兜底封面：确定性生成', () => {
  it('同一 seed 永远同一桶（跨调用稳定）', () => {
    expect(seedIndex('热歌榜', 6)).toBe(seedIndex('热歌榜', 6));
    expect(pickFallbackPalette('热歌榜')).toEqual(pickFallbackPalette('热歌榜'));
  });

  it('不同 seed 能散开（不是恒定一组色）', () => {
    const seeds = ['热歌榜', '新歌榜', 'QQ 热歌榜', '网易云热歌榜', 'abc', 'xyz'];
    const buckets = new Set(seeds.map((s) => seedIndex(s, 6)));
    expect(buckets.size).toBeGreaterThan(1);
  });

  it('桶号恒在范围内（含 buckets <= 0 的退化输入）', () => {
    for (const s of ['', 'a', '热歌榜']) {
      expect(seedIndex(s, 6)).toBeGreaterThanOrEqual(0);
      expect(seedIndex(s, 6)).toBeLessThan(6);
      expect(seedIndex(s, 0)).toBe(0);
    }
  });

  it('取色永远返回调色板里的那一对', () => {
    const p = pickFallbackPalette('新歌榜');
    expect(p).toHaveLength(2);
    expect(p[0]).toMatch(/^#[0-9A-F]{6}$/i);
    expect(p[1]).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('字形：CJK 取首字、拉丁取首字母大写、空名退化成音符', () => {
    expect(coverGlyph('热歌榜')).toBe('热');
    expect(coverGlyph('  qq hot  ')).toBe('Q');
    expect(coverGlyph('')).toBe('♪');
    expect(coverGlyph('   ')).toBe('♪');
  });
});
