import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { createReducedMotionStore } from '../services/reducedMotion';

/**
 * 系统"减弱动效"偏好（iOS Reduce Motion / Android 移除动画）。
 * 传递纪律：动画组件一律内部自取本 hook（SegmentedTabs / ScalePress /PlayerOverlay），不接受外部 
 * prop 覆盖——prop 式会导致调用方忘传时静默退化为「不减弱动效」，恰是无障碍场景最不该发生的默认。
 */
const store = createReducedMotionStore({
  isReduceMotionEnabled: () => AccessibilityInfo.isReduceMotionEnabled(),
  addEventListener: (handler) =>
    AccessibilityInfo.addEventListener('reduceMotionChanged', handler),
});

export function useReducedMotion(): boolean {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
