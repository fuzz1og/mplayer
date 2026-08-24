/**
 * 悬浮 chrome 的尺寸度量 —— 唯一事实源。
 * 各 tab 屏的滚动内容用这里的函数计算让位 padding
 * （内容从半透明 chrome 下穿过，见 UI 重构指南 §8 M2）。
 *
 * 改 chrome 布局时必须同步这里；数值与样式文件中的公式一一对应。
 */

/** TopBar 固定部分：paddingTop(8) + 搜索栏(36) + paddingBottom(8) = 52；状态栏高度由 insets 动态加 */
export const TOP_BAR_FIXED_HEIGHT = 52;

/** 迷你播放栏：paddingVertical(spacing[2]×2=16) + 封面(44) */
export const PLAYER_BAR_HEIGHT = 60;

const TAB_PAD_TOP = 6;
const TAB_ICON_SIZE = 22;
const TAB_LABEL_HEIGHT = 15;
const TAB_PAD_BOTTOM = 24;

/** tab 栏总高（与 (tabs)/_layout.tsx AnimatedTabBar 公式一致） */
export function tabBarHeight(insetsBottom: number): number {
  return TAB_PAD_TOP + TAB_ICON_SIZE + TAB_LABEL_HEIGHT + TAB_PAD_BOTTOM + Math.max(0, insetsBottom - 8);
}

/** 滚动内容底部让位：tab 栏可见时含 tab 栏；搜索页 tab 收起时播放栏直接贴底补安全区 */
export function bottomChromeHeight(insetsBottom: number, tabBarVisible: boolean): number {
  return PLAYER_BAR_HEIGHT + (tabBarVisible ? tabBarHeight(insetsBottom) : insetsBottom);
}

/** 滚动内容顶部让位 */
export function topChromeHeight(insetsTop: number): number {
  return insetsTop + TOP_BAR_FIXED_HEIGHT;
}
