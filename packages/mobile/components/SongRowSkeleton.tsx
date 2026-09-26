import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { radius } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SkeletonBlock from './SkeletonBlock';
import { SONG_ROW } from './songRowMetrics';

/**
 * 单条歌曲行的骨架 —— `SongRow` 的**同形替身**（#416）。
 *
 * 抽成一行组件的原因：推荐页、各类列表页、发现页榜单卡都在重复「封面 + 两行文字
 * （+ 榜位 + 右侧动作）」这个结构，各自手写一次就会各自漂移一次——此前
 * `RecommendSkeleton` 与 `SongListSkeleton` 就是各写一套，且都漏了右侧动作列
 * （导致歌名可用宽度与真实行不同 → 数据到达时文字换行/位移）。
 *
 * 尺寸一律取自 `songRowMetrics`；真实行的每个对应部位都能在这张骨架里找到同形物。
 */
interface Props {
  /** 真实行带榜位序号列（发现页榜单卡）。 */
  showRank?: boolean;
  /** 真实行带右侧动作列（收藏 / 更多）；发现页榜单卡没有。 */
  showActions?: boolean;
  /**
   * 真实行带来源徽章（`SongRow showSource`：收藏 / 专辑 / 歌手 / 歌单 / 搜索）。
   * 徽章在信息列与动作列之间，占宽会改变歌名可用宽度，必须一起占位。
   * 宽度按 `SourceBadge` 的 badge 形态（文字 micro + 6/2 内距，源名 2–3 字）取中值。
   */
  showSource?: boolean;
  /**
   * 分隔线位置。真实 `SongRow` 是每行 `borderBottom`（'bottom'）；
   * 发现页榜单卡是 `i > 0` 时 `borderTop`（首行 'none'，其余 'top'）。
   */
  separator?: 'none' | 'top' | 'bottom';
}

export default function SongRowSkeleton({ showRank = false, showActions = false, showSource = false, separator = 'bottom' }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View
      style={[
        styles.row,
        separator === 'bottom' && styles.sepBottom,
        separator === 'top' && styles.sepTop,
      ]}
    >
      {showRank && <SkeletonBlock style={styles.rank} />}
      <SkeletonBlock style={styles.cover} />
      <View style={styles.info}>
        <SkeletonBlock style={styles.name} />
        <SkeletonBlock style={styles.artist} />
      </View>
      {showSource && <SkeletonBlock style={styles.sourceBadge} />}
      {showActions && (
        <>
          <SkeletonBlock style={styles.action} />
          <SkeletonBlock style={[styles.action, styles.actionCompact]} />
        </>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SONG_ROW.paddingHorizontal,
    paddingVertical: SONG_ROW.paddingVertical,
    backgroundColor: colors.bgSurface,
  },
  sepBottom: {
    borderBottomWidth: SONG_ROW.separatorWidth,
    borderBottomColor: colors.borderSubtle,
  },
  sepTop: {
    borderTopWidth: SONG_ROW.separatorWidth,
    borderTopColor: colors.borderSubtle,
  },
  rank: {
    width: SONG_ROW.rankWidth,
    height: SONG_ROW.nameLineHeight,
    borderRadius: radius.xs,
    marginRight: SONG_ROW.rankGap,
  },
  cover: {
    width: SONG_ROW.coverSize,
    height: SONG_ROW.coverSize,
    borderRadius: SONG_ROW.coverRadius,
    marginRight: SONG_ROW.coverGap,
  },
  info: { flex: 1, marginRight: SONG_ROW.infoGap, justifyContent: 'center' },
  name: { height: SONG_ROW.nameLineHeight, borderRadius: radius.xs, width: '62%' },
  artist: {
    height: SONG_ROW.artistLineHeight,
    borderRadius: radius.xs,
    width: '38%',
    marginTop: SONG_ROW.artistGap,
  },
  sourceBadge: {
    width: SONG_ROW.sourceBadgeWidth,
    height: SONG_ROW.sourceBadgeHeight,
    borderRadius: radius.xs,
    marginRight: SONG_ROW.infoGap,
  },
  action: {
    width: SONG_ROW.actionIconSize,
    height: SONG_ROW.actionIconSize,
    borderRadius: radius.full,
    margin: SONG_ROW.actionPadding,
  },
  actionCompact: {
    width: SONG_ROW.actionIconSizeCompact,
    height: SONG_ROW.actionIconSizeCompact,
    marginLeft: SONG_ROW.actionGap,
  },
});
