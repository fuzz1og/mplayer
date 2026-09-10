/**
 * 折叠头部 chrome 的纯逻辑核心 —— 滚动 → chrome 映射的阈值数学 + 阈值边沿检测。
 *
 * 为什么单独成文件：这里的东西要能在 node 环境直接单测
 * （packages/mobile/vitest.config.ts 的 environment:'node'），
 * 所以**不得 import react-native / react**（由 __tests__/collapsingChrome.test.ts 把关）。
 *
 * 分工：
 *   - 本文件：阈值常量 + 进度定义（含 clamp）+ 状态栏换色的边沿判据；
 *     逐帧的进度由 useCollapsingChrome 用 chromeRanges() 的同一区间交给原生插值
 *     （extrapolate:'clamp'）计算，二者端点由测试绑定一致。
 *   - hooks/useCollapsingChrome.ts：把上面的阈值接到 RN 原生驱动上（帧内不进 JS）。
 */

/** 悬浮导航栏内容高度（不含 insets.top）：nav 高度 = NAV_H + insets.top */
export const NAV_H = 52;

/** 全出血封面基准高度（不含 insets.top）：封面高度 = COVER_BASE_H + insets.top */
export const COVER_BASE_H = 300;

/** 封面底缘雾化条高度（#259 真机原型定稿值，样式引用此常量） */
export const COVER_FOG_H = 64;

/** 淡入窗口宽度：标题淡入 / 返回图标换色 / 状态栏换色共用的 30px 阈值，只此一处 */
export const CHROME_FADE_H = 30;

/** 状态栏样式：light = 浅色图标（压在封面上）；dark = 深色图标（导航条实心后） */
export type StatusBarStyle = 'light' | 'dark';

export interface CollapsingChrome {
  /** 悬浮导航栏内容高度（不含 insets.top） */
  navH: number;
  /** 全出血封面高度 = COVER_BASE_H + insets.top（含状态栏区域） */
  coverH: number;
  /** 导航条完全实心化的滚动点 = coverH - navH - insets.top */
  collapseAt: number;
  /** 淡入窗口起点（状态栏换色阈值）= collapseAt - CHROME_FADE_H */
  fadeStart: number;
}

/** 由安全区顶部内边距推导折叠头部的全部阈值常量 */
export function collapsingChrome(insetsTop: number): CollapsingChrome {
  const coverH = COVER_BASE_H + insetsTop; // 全出血：含状态栏高度
  const collapseAt = coverH - NAV_H - insetsTop; // 导航栏完全实心化的滚动点
  return { navH: NAV_H, coverH, collapseAt, fadeStart: collapseAt - CHROME_FADE_H };
}

/** 逐帧映射的两个滚动窗口：原生插值的 inputRange（clamp 语义 = 下面的 clamp01） */
export interface ChromeRanges {
  /** 导航条背景（透明 → bgSurface）：[0, collapseAt] */
  solid: readonly [number, number];
  /** 标题 / 返回图标 / 状态栏淡入：[fadeStart, collapseAt] */
  fade: readonly [number, number];
}

/** 原生插值区间：与 navProgress / fadeProgress 的 0 → 1 区间逐点对应（测试绑定） */
export function chromeRanges(chrome: CollapsingChrome): ChromeRanges {
  return { solid: [0, chrome.collapseAt], fade: [chrome.fadeStart, chrome.collapseAt] };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 导航条实心化进度：scrollY ∈ [0, collapseAt] → [0,1]，域外 clamp */
export function navProgress(scrollY: number, chrome: CollapsingChrome): number {
  return clamp01(scrollY / chrome.collapseAt);
}

/** 淡入进度：scrollY ∈ [fadeStart, collapseAt] → [0,1]，域外 clamp */
export function fadeProgress(scrollY: number, chrome: CollapsingChrome): number {
  return clamp01((scrollY - chrome.fadeStart) / CHROME_FADE_H);
}

/** 状态栏样式取自淡入窗口的边沿：进入窗口即深色（阈值点本身仍算浅色） */
function statusBarStyle(scrollY: number, chrome: CollapsingChrome): StatusBarStyle {
  return fadeProgress(scrollY, chrome) > 0 ? 'dark' : 'light';
}

/**
 * 状态栏换色的阈值边沿检测器：滚动逐帧喂 update，只有真正跨过阈值
 * （或跨回来）的那一帧才回调一次 —— 同侧的连续帧不产生任何输出、不 setState。
 * 边沿 = 淡入窗口起点 fadeStart，与标题 / 返回图标换色同一个 30px 窗口。
 */
export function createStatusBarEdge(
  onChange: (style: StatusBarStyle) => void,
  initial: StatusBarStyle = 'light',
): (scrollY: number, chrome: CollapsingChrome) => void {
  let last = initial;
  return (scrollY, chrome) => {
    const next = statusBarStyle(scrollY, chrome);
    if (next === last) return;
    last = next;
    onChange(next);
  };
}
