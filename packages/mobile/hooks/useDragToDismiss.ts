import { useRef } from 'react';
import { PanResponder } from 'react-native';
import type { Animated, GestureResponderHandlers, PanResponderInstance } from 'react-native';
import { createDragSession, isVerticalDragClaim, shouldCaptureDrag } from '../gestures/dragSession';

/** 适配器参数：把纯拖拽会话内核（gestures/dragSession）绑到一个 Animated.Value + PanResponder */
export interface DragToDismissOptions {
  /** 被拖拽的位移值（面板 translateY）：跟手期间写值，松手交回调用点做弹簧 */
  value: Animated.Value;
  /** 面板尺寸（一般 useWindowDimensions().height）：事件时刻取最新值，旋转/折叠屏不吃过期值 */
  size: number;
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
  // 旋转/折叠屏时 size 与回调闭包（含其中的 winH）随之刷新，不吃挂载时的过期值
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const session = useRef(createDragSession()).current;
  const panResponderRef = useRef<PanResponderInstance | null>(null);

  if (panResponderRef.current === null) {
    panResponderRef.current = PanResponder.create({
      // 只认领竖直拖拽（dy 严格占优防斜滑）：横向分页 / 子列表滚动优先让给原生
      onMoveShouldSetPanResponder: (_, gs) =>
        isVerticalDragClaim(gs.dx, gs.dy, optionsRef.current.claimThreshold),
      // 纵向优先（可选）：capture 阶段用同一条判定抢在子级 ScrollView 之前拿下手势
      onMoveShouldSetPanResponderCapture: (_, gs) => {
        const { claimThreshold, shouldCapture } = optionsRef.current;
        return shouldCaptureDrag(gs.dx, gs.dy, claimThreshold, shouldCapture?.() ?? false);
      },
      onPanResponderGrant: () => {
        const { value, onGestureStart } = optionsRef.current;
        session.grab();
        onGestureStart?.();
        // 可中断：抓住当前呈现值接管进行中的动画（getValue 异步 → 就绪前的 move 被内核丢弃）
        value.stopAnimation((v) => session.calibrate(v));
      },
      onPanResponderMove: (e, gs) => {
        const { value, size } = optionsRef.current;
        const next = session.move({ dy: gs.dy, timestamp: e.nativeEvent.timestamp, panelSize: size });
        if (next !== null) value.setValue(next);
      },
      onPanResponderRelease: () => {
        const { onDismiss, onSnapBack, onGestureEnd, size } = optionsRef.current;
        const { dismiss, velocity } = session.release(size);
        if (dismiss) onDismiss(velocity);
        else onSnapBack(velocity);
        onGestureEnd?.();
      },
      onPanResponderTerminate: () => {
        const { onSnapBack, onGestureEnd } = optionsRef.current;
        onSnapBack(session.terminate().velocity);
        onGestureEnd?.();
      },
    });
  }
  return panResponderRef.current.panHandlers;
}
