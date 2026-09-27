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
 *
 * 三条纪律，都是此前踩过的坑：
 * 1. **卡片宽度走 `gridCardWidth`**。此前这里把公式抄了一遍
 *    （`(width - spacing[4]*2 - gap*(columns-1))/columns`），而 `gridMetrics` 头注释
 *    明写「统一从这里取数，**禁止在调用方重写公式**」——两份公式必然漂移。
 * 2. **两种网格是两种结构**。专辑/歌单卡 = 方图 + 左对齐两行；歌手卡 = **圆形头像 +
 *    居中一行**（真实 72 圆头像、`marginBottom: 16`）。此前只有前者，3 列歌手网格
 *    加载时形状完全不对。
 * 3. **纵向节奏要与真实网格一致**：真实网格的列间距来自 `columnWrapperStyle` 的
 *    `gap`（只作用于一行之内），行与行之间**没有**间距——所以这里用 `columnGap`
 *    而不是 `gap`，歌手卡的纵向间距由卡片自身的 `marginBottom` 提供（同真实）。
 *
 * 自带主题底色（#318，与 `SongListSkeleton` 同一条纪律）：调用点多为**早退**，
 * 不经过页面容器——页面底色挂在容器上，不画就会露出导航容器自带的浅色默认底。
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
