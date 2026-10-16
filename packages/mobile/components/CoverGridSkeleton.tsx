import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { radius, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SkeletonBlock from './SkeletonBlock';
import { GRID_CARD } from './gridCardMetrics';
import { GRID_GAP, gridCardWidth } from './gridMetrics';

/**
 * 网格加载骨架屏 —— **真实网格的同形替身**（#416）。
 * 此前这里把公式抄了一遍（`(width - spacing[4]*2 - gap*(columns-1))/columns`），而 `gridMetrics` 头
 * 注释明写「统一从这里取数，**禁止在调用方重写公式**」——两份公式必然漂移。
 */
interface Props {
  columns?: number;
  rows?: number;
  /** 'card' = 专辑/歌单（方图 + 两行）；'artist' = 歌手（圆头像 + 一行居中）。 */
  variant?: 'card' | 'artist';
}

export default function CoverGridSkeleton({ columns = 2, rows = 4, variant = 'card' }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cardWidth = gridCardWidth({ cols: columns });
  const total = rows * columns;

  return (
    <View style={styles.wrap}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.item, { width: cardWidth }, variant === 'artist' && styles.itemArtist]}>
          {variant === 'artist' ? (
            <SkeletonBlock style={styles.avatar} />
          ) : (
            <SkeletonBlock style={[styles.cover, { width: cardWidth, height: cardWidth }]} />
          )}
          <SkeletonBlock style={[styles.name, variant === 'artist' && styles.nameArtist]} />
          {variant === 'card' && <SkeletonBlock style={styles.meta} />}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bgBase,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    paddingHorizontal: spacing[4],
    // 只加列间距：真实网格的行间没有间距（见头注释第 3 条）
    columnGap: GRID_GAP,
  },
  item: {},
  itemArtist: {
    alignItems: 'center',
    marginBottom: GRID_CARD.artistCardBottom,
  },
  cover: { borderRadius: GRID_CARD.coverRadius },
  avatar: {
    width: GRID_CARD.artistAvatarSize,
    height: GRID_CARD.artistAvatarSize,
    borderRadius: radius.full,
  },
  name: {
    height: GRID_CARD.nameLineHeight,
    borderRadius: radius.xs,
    marginTop: GRID_CARD.nameGap,
    width: '86%',
  },
  nameArtist: { width: '70%', alignSelf: 'center' },
  meta: {
    height: GRID_CARD.metaLineHeight,
    borderRadius: radius.xs,
    marginTop: GRID_CARD.metaGap,
    width: '52%',
  },
});
