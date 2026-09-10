import { useRef } from 'react';
import { PanResponder } from 'react-native';
import type { Animated, GestureResponderHandlers, PanResponderInstance } from 'react-native';
import {
  allowsTerminationRequest, claimsOnTouchStart, createDragSession, createTouchSequenceGate,
  isVerticalDragClaim, shouldCaptureDrag,
} from '../gestures/dragSession';
import type { DragClaimMode } from '../gestures/dragSession';

/** 适配器参数：把纯拖拽会话内核（gestures/dragSession）绑到一个 Animated.Value + PanResponder */
export interface DragToDismissOptions {
  /** 被拖拽的位移值（面板 translateY）：跟手期间写值，松手交回调用点做弹簧 */
  value: Animated.Value;
  /** 橡皮筋阻尼维度（一般 useWindowDimensions().height）：事件时刻取最新值，旋转/折叠屏不吃过期值 */
  rubberbandSize: number;
  /**
   * 判关基准高度（px）：投影落点越过 `此值 × DISMISS_PROJECT_RATIO` 即判关；
   * 缺省 = rubberbandSize（全屏面板行程 ≈ 屏高）。底部弹层传量出来的面板高度——
   * 短面板拿整屏当基准，正常速度的整段下拉永远够不到判关线。
   */
  dismissSize?: number;
  /**
   * 位置兜底判关比例（缺省 0 = 不启用）：拖动距离越过 `dismissSize × 此比例` 即判关，
   * 不依赖速度。底部弹层传 DISMISS_POSITION_RATIO；全屏面板不传（沿用原手感）。
   */
  positionRatio?: number;
  /**
   * 本层当前是否接受手势（缺省 true）：弹层打开期间传 false —— 遮罩下层的播放器不该响应
   * 任何触摸（真机第二轮：快甩关闭「更多」面板时，播放器被连带关闭）。
   */
  enabled?: boolean;
  /**
   * 认领模式（缺省 `'move'`）：
   * - `'start'`：触摸 DOWN 即成为响应者 + 拒绝让出响应者。**Modal 内的必经路径**
   *   （RN#14295：Modal 内 onMoveShouldSetPanResponder 不触发；BottomSheet 把手用这条）。
   * - `'move'`：move 阶段按阈值认领——挂在根节点、需要把点按/横向滑动先让给子级时用
   *   （全屏播放器）。'start' 模式下 move 认领仍保留为兜底，两者不冲突。
   */
  claimMode?: DragClaimMode;
  /**
   * 认领手势的 |dy| 阈值（px）：各调用点手感不同，故留在调用点声明——
   * 把手热区小（~28px）用小阈值更跟手；全屏面板用大阈值 + dy 严格占优防斜滑误判。
   */
  claimThreshold: number;
  /**
   * 是否在 capture 阶段抢先认领竖直拖拽（默认关）：开启后「先横后竖」的拇指弧线也能被
   * 纵向意图带走，不被横向分页 ScrollView 先抢。判定与 bubble 同一条 isVerticalDragClaim，
   * 故横向拖动（Slider）与点按（ScalePress）天然不受影响。谓词在事件时刻求值（可读 ref），
   * 不是渲染快照——页面切换（封面/歌词）要即时生效。
   */
  shouldCapture?: () => boolean;
  /** 判关：调用点编排退场动画（reducedMotion 分支两端不同，留在调用点） */
  onDismiss: (velocityY: number) => void;
  /** 未判关：回弹到 0（继承松手速度；terminate 为零速兜底） */
  onSnapBack: (velocityY: number) => void;
  /** 手势认领（可选）：调用点联动，如暂停歌词自动滚动 */
  onGestureStart?: () => void;
  /** 手势结束（可选）：release 与 terminate 都会回调（两条路径共用生命周期，不复位标记会漏） */
  onGestureEnd?: () => void;
}

/**
 * 拖拽关闭适配器：给一个位移值 + 面板尺寸，返回可直接摊到 View 上的 panHandlers。
 *
 * 内核（位移计算、速度自采样、松手判决）在 gestures/dragSession，与 PlayerOverlay /
 * BottomSheet 共用同一份实现；这里只做 Animated/PanResponder 的绑定与手势生命周期回调。
 */
export function useDragToDismiss(options: DragToDismissOptions): GestureResponderHandlers {
  // PanResponder 只能建一次（手势回调必须稳定），故实时参数经 ref 取最近一次渲染的值：
  // 旋转/折叠屏时尺寸与回调闭包（含其中的 winH）随之刷新，不吃挂载时的过期值
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const session = useRef(createDragSession()).current;
  // 触摸序列归属闸（见 gestures/dragSession）：Modal 卸载后漏到本层的残余事件序列
  // 没有在本层落下过 DOWN，一律不认领
  const sequence = useRef(createTouchSequenceGate()).current;
  // 关着的时候不清白：等下一次真正落在本层的手势（否则会留着上一轮的 true）
  if (options.enabled === false) sequence.end();
  const panResponderRef = useRef<PanResponderInstance | null>(null);

  if (panResponderRef.current === null) {
    panResponderRef.current = PanResponder.create({
      // 记「本层见过 DOWN」，不抢起点（两条都返回 false，对子级零影响）。
      // bubble 这条必须挂：PanResponder 挂在触摸目标自身时（BottomSheet 把手热区），
      // responder 协商的 capture 阶段不会问到它——真机第三轮教训，只挂 capture 会把
      // 把手拖拽彻底拦死；capture 这条留给 handler 挂在祖先上的场景（全屏播放器根节点）
      // 'start' 模式（Modal 内）：DOWN 即成为响应者，之后所有 move 必然送达；
      // 'move' 模式（根节点）：只记「见过 DOWN」，返回 false 不抢点按
      onStartShouldSetPanResponder: () => {
        sequence.begin();
        return claimsOnTouchStart(optionsRef.current.claimMode ?? 'move');
      },
      onStartShouldSetPanResponderCapture: () => {
        sequence.begin();
        return false;
      },
      // 只认领竖直拖拽（dy 严格占优防斜滑）：横向分页 / 子列表滚动优先让给原生
      onMoveShouldSetPanResponder: (_, gs) => {
        const { claimThreshold, enabled } = optionsRef.current;
        return isVerticalDragClaim(gs.dx, gs.dy, claimThreshold, sequence.allows(enabled ?? true));
      },
      // 纵向优先（可选）：capture 阶段用同一条判定抢在子级 ScrollView 之前拿下手势
      onMoveShouldSetPanResponderCapture: (_, gs) => {
        const { claimThreshold, shouldCapture, enabled } = optionsRef.current;
        return shouldCaptureDrag(gs.dx, gs.dy, claimThreshold,
          sequence.allows(enabled ?? true) && (shouldCapture?.() ?? false));
      },
      // 'start' 模式下必须拒绝让出响应者，否则 Modal/Dialog 会在拖动途中抢走（RN#14295）
      onPanResponderTerminationRequest: () => allowsTerminationRequest(optionsRef.current.claimMode ?? 'move'),
      onPanResponderGrant: () => {
        const { value, onGestureStart } = optionsRef.current;
        sequence.begin(); // grant 即 owned（start 模式在 DOWN 时就已成响应者）
        session.grab();
        onGestureStart?.();
        // 可中断：抓住当前呈现值接管进行中的动画（getValue 异步 → 就绪前的 move 被内核丢弃）
        value.stopAnimation((v) => session.calibrate(v));
      },
      onPanResponderMove: (_, gs) => {
        const { value, rubberbandSize } = optionsRef.current;
        // 时间基准取 JS 单调时钟的「处理时刻」：位置（gs.dy）也取自处理时刻，两者同源才自洽。
        // 真机上 nativeEvent.timestamp 的单位/可用性不可靠，会让速度自采样恒为 0。
        const next = session.move({ dy: gs.dy, timestamp: Date.now(), rubberbandSize });
        if (next !== null) value.setValue(next);
      },
      onPanResponderRelease: () => {
        sequence.end(); // 本次触摸序列结束
        const { onDismiss, onSnapBack, onGestureEnd, rubberbandSize, dismissSize, positionRatio } = optionsRef.current;
        const basis = dismissSize ?? rubberbandSize;
        const ratio = positionRatio ?? 0;
        const { dismiss, velocity } = session.release(basis, ratio);
        if (__DEV__) {
          // 临时诊断（真机第二轮）：确认判关基准与速度采样在真机上的实际取值
          console.log('[drag] release basis=' + basis.toFixed(0) + 'px ratio=' + ratio + ' vy=' + velocity.toFixed(0) + 'px/s → ' + (dismiss ? 'dismiss' : 'snapBack'));
        }
        if (dismiss) onDismiss(velocity);
        else onSnapBack(velocity);
        onGestureEnd?.();
      },
      onPanResponderTerminate: () => {
        sequence.end();
        const { onSnapBack, onGestureEnd } = optionsRef.current;
        onSnapBack(session.terminate().velocity);
        onGestureEnd?.();
      },
    });
  }
  return panResponderRef.current.panHandlers;
}
