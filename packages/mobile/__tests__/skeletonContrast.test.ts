import { describe, expect, it } from 'vitest';
import { darkColors, lightColors } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';

/**
 * 骨架屏可见度下限（#318 真机实测）：
 * 亮色原 `skeletonBase = gray100 #F5F5F7` 比页底 `bgBase #F2F2F7` 还浅，
 * 对比度 **1.02:1** —— 骨架块在亮色下基本不可见，shimmer 更看不见；
 * 真机冷启动截图里骨架帧的两种主色就是 #F2F2F2 / #F5F5F7。
 *
 * 骨架屏是装饰元素，不适用 WCAG 正文阈值；但"看得见"是它的最低职能，
 * 所以这里用**可见度下限**而不是 4.5:1：基色对页底 ≥1.25:1、shimmer 对基色 ≥1.2:1。
 * 谁把 token 调回看不见的值，这条就红。
 */

/** WCAG 相对亮度 */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const THEMES: [string, ThemeColors][] = [
  ['light', lightColors],
  ['dark', darkColors],
];

describe('骨架屏可见度（#318）', () => {
  it.each(THEMES)('%s：骨架基色对页底 bgBase ≥ 1.25:1', (_name, colors) => {
    expect(contrast(colors.skeletonBase, colors.bgBase)).toBeGreaterThanOrEqual(1.25);
  });

  it.each(THEMES)('%s：骨架基色对卡片 bgSurface ≥ 1.15:1', (_name, colors) => {
    expect(contrast(colors.skeletonBase, colors.bgSurface)).toBeGreaterThanOrEqual(1.15);
  });

  it.each(THEMES)('%s：shimmer 高光相对基色 ≥ 1.2:1（扫光可见）', (_name, colors) => {
    expect(contrast(colors.skeletonShine, colors.skeletonBase)).toBeGreaterThanOrEqual(1.2);
  });

  it('亮色基色比页底更深（不能再比底色还浅）', () => {
    expect(luminance(lightColors.skeletonBase)).toBeLessThan(luminance(lightColors.bgBase));
  });
});
