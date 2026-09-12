/**
 * 底部弹层面板高度量取（onLayout）—— 同步取值，绝不把事件对象带进 state updater。
 *
 * 真机教训（PKB110，任何 BottomSheet 打开即 Render Error 白屏）：
 * onLayout 的 `e` 只在事件回调里有效，React 稍后（渲染阶段）才执行 setState 的 updater，
 * 此时事件对象已被回收 —— `e.nativeEvent` 变成 null。把
 * `e.nativeEvent.layout.height` 写进 updater 里就会抛
 * `TypeError: Cannot read property 'layout' of null`。
 *
 * 所以纪律是：handler 内同步把高度读成数字，updater 只闭包那个数字。
 * 本模块把这条纪律钉在接口上（调用点无法再写错），且零 react-native 依赖 → node 可测，
 * 回收场景有回归测试（__tests__/panelHeight.test.ts）。
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
