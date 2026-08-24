import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

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
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (mounted) setReduced(v); })
      .catch(() => {});
    // reduceMotionChanged 事件参数即最新布尔值，可直接作 setter
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
