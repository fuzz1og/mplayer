import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SkeletonBlock from './SkeletonBlock';
import SongRowSkeleton from './SongRowSkeleton';
import { radius, textVariants } from '../theme/tokens';
import { SONG_ROW } from './songRowMetrics';
import { HOTLIST_SECTION } from './hotlistMetrics';
import { DISCOVER_HERO } from './DiscoverHero';
import { CHART_ROW } from './DiscoverChartRow';

/**
 * 发现页排行榜 tab 的加载骨架屏 —— **真实结构（hero + 两张榜单卡）的同形替身**（#416）。
 * 行一律复用 `SongRowSkeleton`（其度量来自 SONG_ROW）；右侧时长列用同一个 CHART_ROW 度量占位。
 */
export default function HotlistSkeleton({ sections = 2, rows = 10 }: { sections?: number; rows?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap}>
      <SkeletonBlock style={styles.hero} />
      {Array.from({ length: sections }, (_, s) => (
        <View key={s} style={styles.section}>
          <View style={styles.sectionHeader}>
            <SkeletonBlock style={styles.sectionTitle} />
            <SkeletonBlock style={styles.sectionAction} />
          </View>
          {Array.from({ length: rows }, (_, r) => (
            /* 卡片内首行无上分隔线，其余行与真实榜单卡一致（borderTop） */
            <View key={r} style={styles.rowWrap}>
              <SongRowSkeleton showRank separator={r > 0 ? 'top' : 'none'} />
              <SkeletonBlock style={styles.duration} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 自带底色 + 撑满：早退的 loading 分支要盖住导航容器的浅色默认底（#318）
  wrap: { flex: 1, backgroundColor: colors.bgBase },
  hero: {
    height: DISCOVER_HERO.height,
    marginTop: DISCOVER_HERO.marginTop,
    marginHorizontal: DISCOVER_HERO.marginHorizontal,
    borderRadius: DISCOVER_HERO.radius,
  },
  section: {
    backgroundColor: colors.bgSurface,
    marginHorizontal: HOTLIST_SECTION.marginHorizontal,
    marginTop: HOTLIST_SECTION.marginTop,
    borderRadius: HOTLIST_SECTION.radius,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HOTLIST_SECTION.headerPaddingHorizontal,
    paddingVertical: HOTLIST_SECTION.headerPaddingVertical,
    borderBottomWidth: SONG_ROW.separatorWidth,
    borderBottomColor: colors.borderSubtle,
  },
  sectionTitle: {
    height: HOTLIST_SECTION.headerLineHeight,
    borderRadius: radius.xs,
    width: '32%',
  },
  sectionAction: {
    height: textVariants.footnote.lineHeight,
    borderRadius: radius.xs,
    width: '18%',
  },
  rowWrap: { position: 'relative' },
  duration: {
    position: 'absolute',
    right: SONG_ROW.paddingHorizontal,
    top: SONG_ROW.paddingVertical + (SONG_ROW.coverSize - CHART_ROW.durationHeight) / 2,
    width: CHART_ROW.durationWidth,
    height: CHART_ROW.durationHeight,
    borderRadius: radius.xs,
  },
});
