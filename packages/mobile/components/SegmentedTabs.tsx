import { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { radius, shadow, textVariants } from '../theme/tokens';
import { lightColors, darkColors } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { springs } from '../theme/motion';
import ScalePress from './ScalePress';

/**
 * iOS 分段控件——灰轨道 + 白滑块，滑块随选中项弹簧滑动
 * （uiDefault 临界阻尼无过冲，ADR-0004；减弱动效直接跳位）。
 * 用于 2–5 个兄弟视图的切换（发现页一级选择器、设置页外观、搜索页歌曲/歌手）。
 */
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.bgActive,
    borderRadius: radius.sm,
    padding: 2,
  },
  thumb: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xs,
    ...shadow.xs,
  },
  item: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...textVariants.subhead,
    color: colors.textSecondary,
  },
  labelActive: {
    color: colors.accent,
    fontWeight: '600',
  },
});

const STYLES = {
  light: makeStyles(lightColors),
  dark: makeStyles(darkColors),
};

export default function SegmentedTabs({ tabs, activeIndex, onSelect, reducedMotion, style }: {
  tabs: { key: string; label: string }[];
  activeIndex: number;
  onSelect: (i: number) => void;
  reducedMotion?: boolean;
  /** 轨道尺寸覆写：两选项的搜索页用紧凑宽度（iOS 搜索结果式居中），默认通栏 */
  style?: StyleProp<ViewStyle>;
}) {
  const { isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const [trackW, setTrackW] = useState(0);
  const thumbX = useRef(new Animated.Value(0)).current;
  // 轨道左右各 2 padding，滑块宽度按剩余空间均分
  const segW = trackW > 4 ? (trackW - 4) / tabs.length : 0;

  useEffect(() => {
    if (segW <= 0) return;
    if (reducedMotion) {
      thumbX.setValue(activeIndex * segW);
      return;
    }
    Animated.spring(thumbX, {
      toValue: activeIndex * segW,
      useNativeDriver: true,
      ...springs.uiDefault,
    }).start();
  }, [activeIndex, segW]);

  return (
    <View style={[styles.track, style]} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {segW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.thumb, { width: segW, transform: [{ translateX: thumbX }] }]}
        />
      )}
      {tabs.map((t, i) => (
        <ScalePress key={t.key} style={styles.item} onPress={() => onSelect(i)}>
          <Text style={[styles.label, activeIndex === i && styles.labelActive]}>{t.label}</Text>
        </ScalePress>
      ))}
    </View>
  );
}
