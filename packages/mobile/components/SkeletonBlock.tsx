import { useMemo, useRef, useEffect } from 'react';
import { View, Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeColors } from '../theme/tokens';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * 骨架屏 shimmer 基元（#186 #6）：灰色圆条 + 扫描高光动画。
 * - reducedMotion 下无动画（纯静态灰条）
 * - 颜色走 skeletonBase/skeletonShine token，双主题自适应
 */
export default function SkeletonBlock({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const shine = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(shine, {
        toValue: 1,
        duration: 1400,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, shine]);

  const translateX = shine.interpolate({
    inputRange: [-1, 1],
    outputRange: [-250, 250],
  });

  return (
    <View style={[styles.base, style]}>
      {!reduced && (
        <Animated.View style={[styles.shine, { transform: [{ translateX }] }]} />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  base: {
    backgroundColor: colors.skeletonBase,
    overflow: 'hidden',
  },
  shine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: colors.skeletonShine,
    opacity: 0.6,
  },
});
