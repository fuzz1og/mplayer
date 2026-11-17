import { useRef } from 'react';
import { Pressable, Animated, StyleSheet, type StyleProp, type ViewStyle, type GestureResponderEvent } from 'react-native';
import type { ViewProps } from 'react-native';
import { springs } from '../theme/motion';
import { opacity } from '../theme/tokens';
import { useReducedMotion } from '../hooks/useReducedMotion';

/** 减弱动效下的按压变暗时长：按下 80ms / 松开 160ms，只做瞬时确认、不常态压暗 */
const REDUCED_PRESS_IN_MS = 80;
const REDUCED_PRESS_OUT_MS = 160;

/**
 * 按压幅度分档语义值（#233/#261 绞杀判例，防魔数散落）：
 * - 行/网格卡/大面板 → pressScale.row（0.98）
 * - 小型图标钮 → 不传 pressScaleTo，用组件默认 0.97
 */
export const pressScale = {
  row: 0.98,
} as const;

interface ScalePressProps {
  /** 接收事件对象以便嵌套场景 stopPropagation（与 TouchableOpacity 行为对齐） */
  onPress?: (e?: GestureResponderEvent) => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** 布局/外观样式：随内容一起缩放（iOS 按压手感是整个控件微微变小） */
  style?: StyleProp<ViewStyle>;
  /** 按压幅度，默认 0.97；整行/大面板用 pressScale.row */
  pressScaleTo?: number;
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
  accessibilityLabel?: ViewProps['accessibilityLabel'];
  accessibilityHint?: ViewProps['accessibilityHint'];
  accessibilityState?: ViewProps['accessibilityState'];
  /** 默认 button；分段/文字 tabs 传 tab，列表行可传 button（默认即可） */
  accessibilityRole?: ViewProps['accessibilityRole'];
  children: React.ReactNode;
}

/**
 * iOS 式按压缩放反馈（替代 TouchableOpacity 的 activeOpacity 变淡）：- 按下即时缩放（响应在 
 * touch-down，不在 release）- 松手用 pressScale 临界阻尼弹簧回弹（ADR-0004），无过冲- 系统"减弱动效
 * "时退化为轻微变暗，不做位移动画
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function ScalePress({
  onPress,
  onLongPress,
  disabled,
  style,
  pressScaleTo = 0.97,
  hitSlop,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  accessibilityRole = 'button',
  children,
}: ScalePressProps) {
  const scale = useRef(new Animated.Value(1)).current;
  // 减弱动效的替代反馈：按下瞬间轻微变暗、松开即恢复（不再常态压到 0.75）
  const dim = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  const pressIn = () => {
    if (reducedMotion) {
      Animated.timing(dim, {
        toValue: 0,
        duration: REDUCED_PRESS_IN_MS,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(scale, {
      toValue: pressScaleTo,
      useNativeDriver: true,
      ...springs.pressScale,
    }).start();
  };
  const pressOut = () => {
    if (reducedMotion) {
      Animated.timing(dim, {
        toValue: 1,
        duration: REDUCED_PRESS_OUT_MS,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      ...springs.pressScale,
    }).start();
  };

  // 调用方可能用 style.opacity 表达禁用（如按钮 disabled 压暗）；减弱动效的按压缩放
  // 必须叠在它的基准上而不是覆盖它。opacity 的类型是 AnimatableNumericValue，
  // 这里只接受数值基准；动画值/百分比基准按 1 处理（本仓调用方只用数值）。
  const rawOpacity = StyleSheet.flatten(style)?.opacity;
  const baseOpacity = typeof rawOpacity === 'number' ? rawOpacity : 1;
  const reducedStyle = reducedMotion
    ? {
        opacity: dim.interpolate({
          inputRange: [0, 1],
          outputRange: [baseOpacity * opacity.pressDim, baseOpacity],
        }),
      }
    : null;

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={
        accessibilityState || disabled
          ? { ...accessibilityState, disabled: disabled || accessibilityState?.disabled }
          : undefined
      }
      style={[style, reducedStyle, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
