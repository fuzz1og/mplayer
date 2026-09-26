import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SongRowSkeleton from './SongRowSkeleton';

/**
 * 列表加载骨架屏 —— **`SongRow` 的同形替身**（#416）。
 *
 * 纪律（本文件存在的理由）：骨架不是「随便几个灰块」，它是**真实结构在数据到达前的样子**；
 * 两者一旦各写各的，数据到达时就会跳版——那正是骨架屏要消除的东西。
 * 单行形状（封面 / 两行文字 / 榜位 / 右侧动作列）与全部尺寸都在 `SongRowSkeleton`
 * + `songRowMetrics` 里，与真实 `SongRow` 同源。此前这里是手写的：纵向内距 8
 * （真实 10）、无分隔线、无 `bgSurface`、**无右侧两列** —— 每行矮 4dp 且歌名可用宽度
 * 与真实行不同，必跳版。
 *
 * 自带主题底色（#318 真机回归）：多个调用点是**早退**（`if (loading) return
 * <SongListSkeleton />`），不经过页面自己的容器——而页面底色挂在容器上。不画底
 * 就会露出 expo-router 导航容器自带的浅色默认底 rgb(242,242,242)（见
 * `theme/AnimatedBg.tsx`），暗色模式下表现为「骨架屏没适配暗色」。
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
