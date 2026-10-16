import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SongRowSkeleton from './SongRowSkeleton';

/**
 * 列表加载骨架屏 —— **`SongRow` 的同形替身**（#416）。
 * 纪律（本文件存在的理由）：骨架不是「随便几个灰块」，它是**真实结构在数据到达前的样子**；两者一旦
 * 各写各的，数据到达时就会跳版——那正是骨架屏要消除的东西。
 */
interface Props {
  rows?: number;
  /** 真实列表带榜位序号列时置真（歌单 / 榜单序号）。 */
  showRank?: boolean;
  /** 真实列表带右侧动作列（收藏 / 更多）时置真；发现页榜单卡请用 `HotlistSkeleton`。 */
  showActions?: boolean;
  /** 真实行带来源徽章（`SongRow showSource`）时置真——徽章占宽会改变歌名宽度。 */
  showSource?: boolean;
}

export default function SongListSkeleton({ rows = 8, showRank = false, showActions = true, showSource = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap}>
      {Array.from({ length: rows }, (_, i) => (
        <SongRowSkeleton key={i} showRank={showRank} showActions={showActions} showSource={showSource} />
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 自带底色 + 撑满：早退的 loading 分支也能盖住导航容器的浅色默认底（#318）
  wrap: { flex: 1, backgroundColor: colors.bgBase, paddingTop: spacing[2] },
});
