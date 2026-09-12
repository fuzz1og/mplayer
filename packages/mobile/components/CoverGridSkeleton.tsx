import { useMemo } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { radius, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SkeletonBlock from './SkeletonBlock';

/**
 * 封面网格骨架屏（#186 #6）：N 列正方形封面占位（对齐歌单/歌手/热榜网格布局），
 * 附带标题两行短条。shimmer 由 SkeletonBlock 提供。
 *
 * 自带主题底色（#318，与 SongListSkeleton 同一条纪律）：调用点多为**早退**
 * （`if (loading) return <CoverGridSkeleton />`），不经过页面容器——页面底色挂在
 * 容器上，不画就会露出 expo-router 导航容器自带的浅色默认底 rgb(242,242,242)，
 * 暗色模式下表现为「骨架屏没适配暗色」。范式同 components/LoadingState.tsx。
 */
export default function CoverGridSkeleton({ columns = 2, rows = 4 }: { columns?: number; rows?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const gap = spacing[3];
  const cellWidth = (width - spacing[4] * 2 - gap * (columns - 1)) / columns;
  return (
    <View style={styles.wrap}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={styles.row}>
          {Array.from({ length: columns }, (_, c) => (
            <View key={c} style={{ width: cellWidth }}>
              <SkeletonBlock style={{ width: cellWidth, height: cellWidth, borderRadius: radius.md }} />
              <SkeletonBlock style={styles.textLine} />
              <SkeletonBlock style={[styles.textLine, styles.textLineShort]} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    gap: spacing[3],
  },
  row: { flexDirection: 'row', gap: spacing[3] },
  textLine: {
    height: 12,
    borderRadius: radius.sm,
    marginTop: spacing[2],
    width: '85%',
  },
  textLineShort: {
    width: '55%',
    marginTop: spacing[1],
  },
});
