import { describe, expect, it } from 'vitest';
import { darkColors, lightColors } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { contrast } from './contrastUtils';

/**
 * 主题对比度回归（#318 审计）：
 * - 小字号正文/图标用的 accent、danger 必须达到 4.5:1（审计前：暗 accent 3.34~4.08、
 *   亮 danger 4.33，均擦线不达标）；
 * - 层级顺序保持不变（disabled < tertiary < secondary < primary 亮度递增）——
 *   tertiary 刻意保持低对比（苹果式层级），所以这里**不**要求它达标，
 *   只要求它别越过上级；当正文用的地方改走 textSecondary。
 */
const THEMES: [string, ThemeColors][] = [
  ['light', lightColors],
  ['dark', darkColors],
];

describe('主题对比度（#318 审计）', () => {
  it.each(THEMES)('%s：accent 文字对所有承载面 ≥ 4.5:1', (_n, c) => {
    for (const bg of ['bgBase', 'bgSurface', 'bgElevated', 'bgHover'] as const) {
      expect(contrast(c.accent, c[bg]), `${_n} accent on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('%s：dangerText 对页底与卡片 ≥ 4.5:1', (_n, c) => {
    expect(contrast(c.dangerText, c.bgBase)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.dangerText, c.bgSurface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s：textSecondary（正文级空态/元信息）对页底与卡片 ≥ 4.5:1', (_n, c) => {
    expect(contrast(c.textSecondary, c.bgBase)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.textSecondary, c.bgSurface)).toBeGreaterThanOrEqual(4.5);
  });

  // 层级顺序按「相对页底的对比度」表述才双主题通用：
  // 亮色 disabled 最浅（最接近页底），暗色 disabled 最深（最接近纯黑）——
  // 两者都表现为 contrast(disabled) < contrast(tertiary) < contrast(secondary) < contrast(primary)。
  it.each(THEMES)('%s：文字层级（相对页底对比度）保持 disabled < tertiary < secondary < primary', (_n, c) => {
    const at = (fg: string) => contrast(fg, c.bgBase);
    expect(at(c.textDisabled)).toBeLessThan(at(c.textTertiary));
    expect(at(c.textTertiary)).toBeLessThan(at(c.textSecondary));
    expect(at(c.textSecondary)).toBeLessThan(at(c.textPrimary));
  });

  it('亮色：textTertiary 刻意保持低对比（苹果式层级，仅装饰/提示用）', () => {
    // 记录设计决定：亮色 tertiary(#AEAEB2) 对白卡只有 2.21:1，是有意的弱层级；
    // 因此「当正文用」的地方必须走 textSecondary（本轮已把空态文字/序号改过去）。
    // 暗色 tertiary(#8E8E93) 对卡片 5.22:1，不受此约束。
    expect(contrast(lightColors.textTertiary, lightColors.bgSurface)).toBeLessThan(3.5);
    expect(contrast(lightColors.textSecondary, lightColors.bgSurface)).toBeGreaterThanOrEqual(4.5);
  });
});
