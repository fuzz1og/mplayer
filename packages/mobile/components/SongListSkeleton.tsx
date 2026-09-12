import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { radius, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SkeletonBlock from './SkeletonBlock';

/**
 * 列表加载骨架屏（#186 #6）：行高/间距与 SongRow 一致（44 封面 + 两行文字），
 * shimmer 由 SkeletonBlock 提供，避免数据到达时布局跳动。
 *
 * 自带主题底色（#318 真机回归）：多个调用点是**早退**（`if (loading) return
 * <SongListSkeleton />`），不经过页面自己的容器——而页面底色挂在容器上。不画底
 * 就会露出 expo-router 导航容器自带的浅色默认底 rgb(242,242,242)（见
 * `theme/AnimatedBg.tsx`），暗色模式下表现为「骨架屏没适配暗色」。
 */
export default function SongListSkeleton({ rows = 8 }: { rows?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <SkeletonBlock style={styles.cover} />
          <View style={styles.info}>
            <SkeletonBlock style={styles.line} />
            <SkeletonBlock style={[styles.line, styles.lineShort]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 自带底色 + 撑满：早退的 loading 分支也能盖住导航容器的浅色默认底（#318）
  wrap: { flex: 1, backgroundColor: colors.bgBase, paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    marginRight: spacing[3],
  },
  info: { flex: 1 },
  line: {
    height: 13,
    borderRadius: radius.sm,
    width: '60%',
  },
  lineShort: {
    width: '35%',
    marginTop: 8,
  },
});
