/**
 * 悬浮 chrome 的尺寸度量 —— 唯一事实源。
 * 各 tab 屏的滚动内容用这里的函数计算让位 padding
 * （内容从半透明 chrome 下穿过，见 UI 重构指南 §8 M2）。
 *
 * 样式文件不得逐值重写这里的数值：TopBar / (tabs)/_layout 的
 * 对应样式必须从这里 import 常量或由常量推导（见各文件引用处）。
 */

/* ── TopBar 固定部分 ─────────────────────────────── */

/** TopBar container 垂直 padding（TopBar.tsx container paddingVertical 引用此值） */
export const TOP_BAR_PAD_VERTICAL = 8;

/** TopBar 搜索栏高度（TopBar.tsx searchBar height 引用此值） */
export const SEARCH_BAR_HEIGHT = 36;

/** TopBar 固定部分总高：paddingVertical×2 + 搜索栏；状态栏高度由 insets 动态加 */
export const TOP_BAR_FIXED_HEIGHT = TOP_BAR_PAD_VERTICAL * 2 + SEARCH_BAR_HEIGHT;

/** 迷你播放栏：paddingVertical(spacing[2]×2=16) + 封面(44) */
export const PLAYER_BAR_HEIGHT = 60;

/* ── tab 栏 ──────────────────────────────────────── */

/** tab 栏内容高度组成（(tabs)/_layout.tsx AnimatedTabBar 引用，不再本地双写） */
export const TAB_PAD_TOP = 6;
export const TAB_ICON_SIZE = 22;
export const TAB_LABEL_HEIGHT = 15; // 标签字号 11（micro 同级；带 lineHeight 成对样式不套变体）+ marginTop 2
export const TAB_PAD_BOTTOM = 24;

/** tab 栏安全区抵扣：底栏不贴满 insets.bottom，留 8pt 呼吸（公式中的 -8） */
export const TAB_SAFE_INSET_MIN = 8;

/** tab 栏总高（与 (tabs)/_layout.tsx AnimatedTabBar 公式一致） */
export function tabBarHeight(insetsBottom: number): number {
  return TAB_PAD_TOP + TAB_ICON_SIZE + TAB_LABEL_HEIGHT + TAB_PAD_BOTTOM + Math.max(0, insetsBottom - TAB_SAFE_INSET_MIN);
}

/** 滚动内容底部让位：tab 栏可见时含 tab 栏；搜索页 tab 收起时播放栏直接贴底补安全区 */
export function bottomChromeHeight(insetsBottom: number, tabBarVisible: boolean): number {
  return PLAYER_BAR_HEIGHT + (tabBarVisible ? tabBarHeight(insetsBottom) : insetsBottom);
}

/** 滚动内容顶部让位 */
export function topChromeHeight(insetsTop: number): number {
  return insetsTop + TOP_BAR_FIXED_HEIGHT;
}

/* ── 列表尾差 ────────────────────────────────────── */

/**
 * 各屏在 bottomChromeHeight 之外追加的列表尾差（末行呼吸空间/刷新控件余量）。
 * 语义差异：普通列表（下载页/发现页各 tab）留 24；推荐/歌单页节距大留 32；
 * 搜索页 tab 收起、底部贴播放栏，16 即够（历史取值，保留既有观感，不再散落魔数）。
 */
export const LIST_TAIL_PADDING = 24;
export const SECTION_TAIL_PADDING = 32;
export const SEARCH_TAIL_PADDING = 16;
