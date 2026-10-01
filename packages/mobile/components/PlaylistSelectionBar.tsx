import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import ScalePress from './ScalePress';

/**
 * 选择模式的顶部 sticky 条（#490）：左「完成」、中「已选 N 项」、右「全选 / 取消全选」。
 *
 * 位置由调用方（PlaylistHero）钉在 CollapsingHero 悬浮导航栏**正下方**——
 * 放顶部而不是底部是为了不与页面底部的 BottomSafePlayerBar 抢位置。
 */
export default function PlaylistSelectionBar({
  count,
  allSelected,
  onExit,
  onToggleAll,
}: {
  /** 已选**当前列表内**的曲目数（不是 ids.size：外部删歌后可能残留陈旧 id） */
  count: number;
  allSelected: boolean;
  /** 完成：退出选择模式 */
  onExit: () => void;
  /** 全选 / 取消全选（作用于完整列表） */
  onToggleAll: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.bar}>
      <ScalePress
        style={styles.side}
        onPress={onExit}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.action}>完成</Text>
      </ScalePress>
      <Text style={styles.count} numberOfLines={1}>已选 {count} 项</Text>
      <ScalePress
        style={[styles.side, styles.sideRight]}
        onPress={onToggleAll}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.action}>{allSelected ? '取消全选' : '全选'}</Text>
      </ScalePress>
    </View>
  );
}

const SIDE_MIN_WIDTH = 76;

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: spacing[4],
    backgroundColor: colors.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  // 两侧等宽，中间计数才会真正居中（「取消全选」比「全选」宽）
  side: { minWidth: SIDE_MIN_WIDTH, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  action: { ...textVariants.footnote, fontWeight: '600', color: colors.accent },
  count: { flex: 1, textAlign: 'center', ...textVariants.footnote, color: colors.textSecondary },
});
