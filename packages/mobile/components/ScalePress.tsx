import { useRef } from 'react';
import { Pressable, Animated, StyleSheet, type StyleProp, type ViewStyle, type GestureResponderEvent } from 'react-native';
import { springs } from '../theme/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';

interface ScalePressProps {
  /** 接收事件对象以便嵌套场景 stopPropagation（与 TouchableOpacity 行为对齐） */
  onPress?: (e?: GestureResponderEvent) => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** 布局/外观样式：随内容一起缩放（iOS 按压手感是整个控件微微变小） */
  style?: StyleProp<ViewStyle>;
  /** 按压幅度，默认 0.97；整行/大面板建议 0.98 */
  pressScaleTo?: number;
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
  children: React.ReactNode;
}

/**
 * iOS 式按压缩放反馈（替代 TouchableOpacity 的 activeOpacity 变淡）：
 * - 按下即时缩放（响应在 touch-down，不在 release）
 * - 松手用 pressScale 临界阻尼弹簧回弹（ADR-0004），无过冲
 * - 系统"减弱动效"时退化为轻微变暗，不做位移动画
 *
 * 用 Animated.createAnimatedComponent(Pressable) 把布局样式与缩放变换挂在
 * 同一个节点上：双节点（Pressable>Animated.View）要么 flex 丢在外层（tab 塌缩）、
 * 要么 flexDirection 丢在内层（SongRow 竖排），单节点才两者都对。
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function ScalePress({
  onPress,
  onLongPress,
  disabled,
  style,
  pressScaleTo = 0.97,
  hitSlop,
  children,
}: ScalePressProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  const pressIn = () => {
    if (reducedMotion) return;
    Animated.spring(scale, {
      toValue: pressScaleTo,
      useNativeDriver: true,
      ...springs.pressScale,
    }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      ...springs.pressScale,
    }).start();
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      style={[style, reducedMotion && styles.reducedDim, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // 减弱动效下的非前庭替代反馈：轻微降不透明度（保留"按到了"的确认感）
  reducedDim: { opacity: 0.75 },
});
