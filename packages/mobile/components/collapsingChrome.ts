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

/**
 * 导航条背景颜色插值的输入计划（#372）。
 *
 * RN 0.86 原生驱动里两条插值路径对 extrapolate 的处理**不一致**：
 *   - 数值插值 InterpolationAnimatedNode::interpolateValue → interpolate()
 *     （ReactCommon/react/renderer/animated/drivers/AnimationDriverUtils.h）**结算** extrapolate:'clamp'；
 *   - 颜色插值 InterpolationAnimatedNode::interpolateColor()
 *     （ReactCommon/react/renderer/animated/nodes/InterpolationAnimatedNode.cpp:104-152）**忽略** extrapolate，
 *     直接 ratio = (value - inputMin)/(inputMax - inputMin)，再逐通道 static_cast<uint8_t>（超界即回绕）。
 *
 * 所以颜色节点不能直接吃原始 scrollY：滚过 collapseAt 后 ratio > 1，alpha 会在 1px 内
 * 从 255 回绕到 0（条身消失），继续滚周期性闪烁偏色（深色模式尤其明显）。计划把颜色节点
 * 串在数值 clamp 节点之后，保证颜色节点 ratio 恒 ∈ [0,1]。接线见 hooks/useCollapsingChrome.ts。
 */
export interface NavBackgroundPlan {
  /** 第 1 段（数值插值）：scrollY → clamp 到 [0, collapseAt] */
  inputClamp: {
    inputRange: readonly [number, number];
    outputRange: readonly [number, number];
  };
  /** 第 2 段（颜色插值）：输入必须是 inputClamp 的输出 */
  color: {
    inputRange: readonly [number, number];
    outputRange: readonly [string, string];
  };
}

/** 压在封面上的导航条起点色：透明白。封面上的「白洗」渐入是既有观感（勿改成纯 opacity 层） */
export const NAV_BG_ON_COVER = 'rgba(255,255,255,0)'; // design-lint: ok 折叠头部导航条压在封面上的透明起点色（原生颜色插值端点，非主题表面）

/** 由折叠阈值与主题 bgSurface 生成导航条背景的两段插值计划 */
export function navBackgroundPlan(chrome: CollapsingChrome, bgSurface: string): NavBackgroundPlan {
  const range = chromeRanges(chrome).solid;
  return {
    inputClamp: { inputRange: range, outputRange: range },
    color: { inputRange: range, outputRange: [NAV_BG_ON_COVER, bgSurface] },
  };
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
