/**
 * 底部弹层面板高度量取（onLayout）—— 同步取值，绝不把事件对象带进 state updater。
 * 把`e.nativeEvent.layout.height` 写进 updater 里就会抛`TypeError: Cannot read property 'layout' of
 * null`。
 */

/** onLayout 事件里用得上的最小形状：不引 react-native 类型，保持 node 可测 */
export interface PanelLayoutEvent {
  nativeEvent: { layout: { height: number } };
}

/** 亚像素抖动阈值（px）：差值小于此值不回写，避免无谓重渲染 */
const SUBPIXEL_EPSILON = 1;

/**
 * onLayout 处理器：同步读高度 → 交给 state updater（亚像素抖动保留旧值）。
 * updater 只闭包 height 数字，不碰事件对象，故事件回收后才执行也安全。
 */
export function handlePanelLayout(
  setHeight: (updater: (prev: number) => number) => void,
  event: PanelLayoutEvent,
): void {
  const height = event.nativeEvent.layout.height; // 必须同步取值：事件对象随后被回收
  setHeight((prev) => (Math.abs(prev - height) < SUBPIXEL_EPSILON ? prev : height));
}
