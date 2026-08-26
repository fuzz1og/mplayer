import { View, StyleSheet } from 'react-native';
import { radius, spacing } from '../theme/tokens';
import SkeletonBlock from './SkeletonBlock';

/**
 * 列表加载骨架屏（#186 #6）：行高/间距与 SongRow 一致（44 封面 + 两行文字），
 * shimmer 由 SkeletonBlock 提供，避免数据到达时布局跳动。
 */
export default function SongListSkeleton({ rows = 8 }: { rows?: number }) {
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
