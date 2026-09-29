/**
 * 兜底封面的**纯内核**（#465）：零 react-native / 零 expo 依赖，node 环境直接单测。
 *
 * 与 CoverFallback.tsx 的分工照搬仓库既有惯例（gestures/dragJank ↔ dragJankProbe、
 * collapsingChrome ↔ useCollapsingChrome）：确定性算法留在纯模块，渲染留在组件。
 */

/** 6 组深浅主题通用的低饱和色对（不抢真实封面，也不至于糊成一块灰）。 */
// 下面是「生成的封面图」的配色，不是 UI 表面色：它模拟的是一张专辑/榜单封面插画，
// 没有主题 token 语义（深浅主题下都该是同一张图），故整表豁免 design-lint。
export const FALLBACK_PALETTES: readonly (readonly [string, string])[] = [
  ['#2B3A67', '#4A6FA5'], // design-lint: ok 兜底封面插画配色（非 UI 表面色）
  ['#4A2B4F', '#8E5C8F'], // design-lint: ok 兜底封面插画配色（非 UI 表面色）
  ['#1F3D3A', '#2F7A6B'], // design-lint: ok 兜底封面插画配色（非 UI 表面色）
  ['#4A3520', '#A5703C'], // design-lint: ok 兜底封面插画配色（非 UI 表面色）
  ['#2A2F4A', '#5C6BC0'], // design-lint: ok 兜底封面插画配色（非 UI 表面色）
  ['#3D2230', '#9C5262'], // design-lint: ok 兜底封面插画配色（非 UI 表面色）
];

/** FNV-1a 截断哈希：确定性，同一 seed 永远同一桶。 */
export function seedIndex(seed: string, buckets: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return buckets > 0 ? h % buckets : 0;
}

/** 按实体名取一组兜底色（同 seed 必须同色）。 */
export function pickFallbackPalette(seed: string): readonly [string, string] {
  return FALLBACK_PALETTES[seedIndex(seed, FALLBACK_PALETTES.length)]!;
}

/** 字形：CJK 取首字；拉丁取首字母大写；空名退化成音符。 */
export function coverGlyph(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '♪';
  const first = Array.from(trimmed)[0]!;
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}
