import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { createReducedMotionStore } from '../services/reducedMotion';

/**
 * 系统"减弱动效"偏好（iOS Reduce Motion / Android 移除动画）。
 *
 * 使用规则（ADR-0004 / apple-design §14）：减弱动效 ≠ 没有反馈——
 * 大位移动画（滑动、弹簧）退化为 cross-fade，循环装饰动画停止，
 * 颜色/透明度等不引起前庭反应的反馈保留。
 *
 * 传递纪律：动画组件一律内部自取本 hook（SegmentedTabs / ScalePress /
 * PlayerOverlay），不接受外部 prop 覆盖——prop 式会导致调用方忘传时
 * 静默退化为「不减弱动效」，恰是无障碍场景最不该发生的默认。
 *
 * 订阅纪律（#304）：全应用共享 services/reducedMotion.ts 的单例 store——
 * 一个 AccessibilityInfo 监听器 + 一份缓存值；本 hook 只做 RN 适配，
 * 调用方 API 不变（含初值 false 与事件参数直取的语义）。
 */
const store = createReducedMotionStore({
  isReduceMotionEnabled: () => AccessibilityInfo.isReduceMotionEnabled(),
  addEventListener: (handler) =>
    AccessibilityInfo.addEventListener('reduceMotionChanged', handler),
});

export function useReducedMotion(): boolean {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
