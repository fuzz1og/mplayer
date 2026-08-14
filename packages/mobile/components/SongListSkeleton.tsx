import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';

/**
 * 列表加载骨架屏：行高/间距与 SongRow 一致（44 封面 + 两行文字），
 * 灰色圆条占位，避免数据到达时布局跳动。
 */
export default function SongListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <View style={styles.wrap}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.cover} />
          <View style={styles.info}>
            <View style={[styles.line, { width: '60%' }]} />
            <View style={[styles.line, { width: '35%', marginTop: 8 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.skeletonBase,
    marginRight: spacing[3],
  },
  info: { flex: 1 },
  line: {
    height: 13,
    borderRadius: radius.sm,
    backgroundColor: colors.skeletonBase,
  },
});
