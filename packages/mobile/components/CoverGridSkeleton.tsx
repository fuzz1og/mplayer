import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { radius, spacing } from '../theme/tokens';
import SkeletonBlock from './SkeletonBlock';

/**
 * 封面网格骨架屏（#186 #6）：N 列正方形封面占位（对齐歌单/歌手/热榜网格布局），
 * 附带标题两行短条。shimmer 由 SkeletonBlock 提供。
 */
export default function CoverGridSkeleton({ columns = 2, rows = 4 }: { columns?: number; rows?: number }) {
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

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[3] },
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
