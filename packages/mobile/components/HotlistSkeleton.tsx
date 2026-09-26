import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SkeletonBlock from './SkeletonBlock';
import SongRowSkeleton from './SongRowSkeleton';
import { SONG_ROW } from './songRowMetrics';
import { HOTLIST_SECTION } from './hotlistMetrics';

/**
 * 发现页榜单 tab 的加载骨架屏 —— **`SectionCard` 的同形替身**（#416）。
 *
 * 与真实结构逐项对齐：N 张分组卡片（左右外边距 / 上间距 / 圆角 / 裁切）→
 * 卡内标题行（同内距与行高）→ 每卡 `previewRows` 首歌行（同 `SONG_ROW` 度量，
 * 含榜位列；该 tab 的歌曲行**没有**收藏/更多两列，故 `showActions` 关闭）。
 *
 * 卡片数由调用方传入（真实 `SECTIONS.length`），不在这里写死。
 */
export default function HotlistSkeleton({ sections, rows = HOTLIST_SECTION.previewRows }: { sections: number; rows?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap}>
      {Array.from({ length: sections }, (_, s) => (
        <View key={s} style={styles.section}>
          <View style={styles.sectionHeader}>
            <SkeletonBlock style={styles.sectionTitle} />
          </View>
          {Array.from({ length: rows }, (_, r) => (
            /* 卡片内首行无上分隔线，其余行与真实榜单卡一致（borderTop，见 SectionCard） */
            <SongRowSkeleton key={r} showRank separator={r > 0 ? 'top' : 'none'} />
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 自带底色 + 撑满：早退的 loading 分支要盖住导航容器的浅色默认底（#318）
  wrap: { flex: 1, backgroundColor: colors.bgBase },
  section: {
    backgroundColor: colors.bgSurface,
    marginHorizontal: HOTLIST_SECTION.marginHorizontal,
    marginTop: HOTLIST_SECTION.marginTop,
    borderRadius: HOTLIST_SECTION.radius,
    overflow: 'hidden',
  },
  sectionHeader: {
    paddingHorizontal: HOTLIST_SECTION.headerPaddingHorizontal,
    paddingVertical: HOTLIST_SECTION.headerPaddingVertical,
    borderBottomWidth: SONG_ROW.separatorWidth,
    borderBottomColor: colors.borderSubtle,
  },
  sectionTitle: {
    height: HOTLIST_SECTION.headerLineHeight,
    borderRadius: 4,
    width: '46%',
  },
});
