import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NAV_BG_ON_COVER,
  chromeRanges,
  collapsingChrome,
  navBackgroundPlan,
} from '../components/collapsingChrome';

/**
 * 折叠头部导航条背景色防回归（#372）。
 *
 * RN 0.86 原生驱动里两条插值路径对 extrapolate 的处理**不一致**：
 *   - 数值：InterpolationAnimatedNode::interpolateValue → interpolate()
 *     （ReactCommon/react/renderer/animated/drivers/AnimationDriverUtils.h）结算
 *     extrapolate:'clamp'；
 *   - 颜色：InterpolationAnimatedNode::interpolateColor()
 *     （ReactCommon/react/renderer/animated/nodes/InterpolationAnimatedNode.cpp:104-152）
 *     **忽略 extrapolate**，直接 ratio = (value - inputMin)/(inputMax - inputMin)，
 *     再逐通道 static_cast<uint8_t>（超界即回绕）。
 *
 * 所以颜色节点必须吃「数值 clamp 节点」的输出。下面按原生算法逐值复算，锁死
 * 「颜色节点 ratio 恒 ∈ [0,1]」这条契约：一旦接线退回把原始 scrollY 直接喂给
 * 颜色节点，ratio 就会 > 1 并回绕 —— scrollY = collapseAt + 1 时 alpha 从 255
 * 掉到 0，条身整条消失、随后周期性闪烁偏色。
 */

/** darkColors.bgSurface（packages/mobile/theme/tokens.ts:475 → palette.gray900） */
const DARK_BG_SURFACE = '#1C1C1E';

/** RN processColor：0xrrggbbaa → 0xaarrggbb（android 再转 signed int32） */
function processColor(css: string): number {
  const hex6 = /^#([0-9a-f]{6})$/i.exec(css);
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(css);
  let n: number;
  if (hex6) {
    n = parseInt(hex6[1] + 'ff', 16) >>> 0;
  } else if (rgba) {
    n = (((+rgba[1] << 24) | (+rgba[2] << 16) | (+rgba[3] << 8) | Math.round((+(rgba[4] ?? 1)) * 255)) >>> 0);
  } else {
    throw new Error('processColor 模型未覆盖: ' + css);
  }
  n = ((n << 24) | (n >>> 8)) >>> 0; // 0xrrggbbaa -> 0xaarrggbb
  return n | 0;
}

const alpha = (argb: number) => (argb >>> 24) & 0xff;
const channel = (argb: number, shift: number) => (argb >> shift) & 0xff;

/** static_cast<uint8_t> 超界回绕（原生侧 out-of-range float→uint8 的实际观感） */
const u8 = (f: number) => ((Math.trunc(f) % 256) + 256) % 256;

/** 原生数值插值：结算 extrapolate（AnimationDriverUtils.h interpolate） */
function nativeInterpolateValue(
  value: number,
  inputRange: readonly [number, number],
  outputRange: readonly [number, number],
  extrapolate: 'clamp' | 'extend',
): number {
  let result = value;
  if (result < inputRange[0] && extrapolate === 'clamp') result = inputRange[0];
  if (result > inputRange[1] && extrapolate === 'clamp') result = inputRange[1];
  const [iMin, iMax] = inputRange;
  const [oMin, oMax] = outputRange;
  if (iMin === iMax) return value <= iMin ? oMin : oMax;
  return oMin + ((oMax - oMin) * (result - iMin)) / (iMax - iMin);
}

/** 原生颜色插值：**不**结算 extrapolate（InterpolationAnimatedNode.cpp:104-152） */
function nativeInterpolateColor(
  value: number,
  inputRange: readonly [number, number],
  outputRange: readonly number[],
): { ratio: number; argb: number } {
  const [iMin, iMax] = inputRange;
  const [oMin, oMax] = outputRange;
  const ratio = (value - iMin) / (iMax - iMin);
  const lerp = (shift: number) => u8(ratio * (channel(oMax, shift) - channel(oMin, shift)) + channel(oMin, shift));
  const argb = ((lerp(24) << 24) | (lerp(16) << 16) | (lerp(8) << 8) | lerp(0)) >>> 0;
  return { ratio, argb };
}

const planArgb = (bgSurface: string) => navBackgroundPlan(collapsingChrome(59), bgSurface).color.outputRange.map(processColor);

describe('导航条背景颜色节点的输入契约', () => {
  it('全程 ratio ∈ [0,1]；滚过折叠点后颜色冻结在 bgSurface，不回绕', () => {
    const chrome = collapsingChrome(59); // collapseAt = 248
    const plan = navBackgroundPlan(chrome, DARK_BG_SURFACE);
    const end = processColor(DARK_BG_SURFACE) >>> 0;

    for (let y = 0; y <= chrome.collapseAt * 6; y++) {
      const clamped = nativeInterpolateValue(
        y,
        plan.inputClamp.inputRange,
        plan.inputClamp.outputRange,
        'clamp',
      );
      const { ratio, argb } = nativeInterpolateColor(clamped, plan.color.inputRange, planArgb(DARK_BG_SURFACE));
      expect(ratio, 'scrollY=' + y).toBeGreaterThanOrEqual(0);
      expect(ratio, 'scrollY=' + y).toBeLessThanOrEqual(1);
      if (y >= chrome.collapseAt) {
        expect(argb, 'scrollY=' + y).toBe(end);
      }
    }
  });

  it('颜色区间端点 = [透明白, bgSurface]，且 clamp 段输出 = 颜色段输入', () => {
    const chrome = collapsingChrome(59);
    const plan = navBackgroundPlan(chrome, DARK_BG_SURFACE);
    expect(plan.color.outputRange).toEqual([NAV_BG_ON_COVER, DARK_BG_SURFACE]);
    expect(plan.color.inputRange).toEqual(chromeRanges(chrome).solid);
    expect(plan.inputClamp.inputRange).toEqual(chromeRanges(chrome).solid);
    expect(plan.inputClamp.outputRange).toEqual(plan.color.inputRange);
  });

  it('反例锚点：若把原始 scrollY 直接喂颜色节点，collapseAt+1 处 ratio>1 且 alpha 回绕到 0', () => {
    const chrome = collapsingChrome(59);
    const raw = nativeInterpolateColor(
      chrome.collapseAt + 1,
      navBackgroundPlan(chrome, DARK_BG_SURFACE).color.inputRange,
      planArgb(DARK_BG_SURFACE),
    );
    expect(raw.ratio).toBeGreaterThan(1);
    expect(alpha(raw.argb)).toBe(0); // 255 * 1.004 回绕成 0 —— 条身瞬间消失
  });
});

describe('接线：hook 的 navBg 必须由 clamp 后的颜色节点派生', () => {
  it('useCollapsingChrome 消费 navBackgroundPlan', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../hooks/useCollapsingChrome.ts', import.meta.url).href),
      'utf8',
    );
    expect(src).toMatch(/navBackgroundPlan/);
  });
});
