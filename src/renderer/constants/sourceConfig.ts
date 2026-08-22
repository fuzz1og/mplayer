import type { SourceKey } from '@mplayer/core';

/**
 * 音乐源品牌色 — 单一来源。
 * 与移动端 packages/mobile/theme/tokens.ts 的 sourceColors 对齐；
 * 桌面端各组件（SourceBadge / TopBar / SourceSwapModal / LinkPreviewTable…）统一引用，禁止再散写。
 */
export const SOURCE_COLORS: Record<SourceKey, string> = {
  netease: '#E74C3C',
  qq: '#1DB954',
  kugou: '#FF8C00',
  kuwo: '#FF6F00',
  migu: '#FF5A00',
  qianqian: '#00A1D6',
  soda: '#1E90FF',
  local: '#10B981',
};

/** 「全部」聚合源品牌色 */
export const ALL_SOURCE_COLOR = '#8B5CF6';

/** 从 sourceType 取品牌色；未知源回退到聚合色 */
export function sourceColor(source: string | undefined | null): string {
  if (source && source in SOURCE_COLORS) return SOURCE_COLORS[source as SourceKey];
  return ALL_SOURCE_COLOR;
}
