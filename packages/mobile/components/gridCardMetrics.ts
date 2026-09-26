import { radius, spacing, textVariants } from '../theme/tokens';

/**
 * 网格卡片的布局度量 —— **单一事实源**（#416）。
 *
 * 两种网格是两种结构，各自一套度量：
 * - **专辑 / 歌单卡**：方图（`coverRadius`）+ 左对齐标题两行截断 + 副行 meta；
 * - **歌手卡**：圆形头像（`artistAvatarSize`）+ 居中一行名字 + 卡片下间距。
 *
 * 真实网格（`DiscoverTabs` 的 `gridCover/gridName/gridMeta/artistCard/artistAvatar/artistName`、
 * `RecommendSkeleton` 的猜你喜欢）与骨架屏从同一份取数。宽度公式不在这里——
 * 一律走 `gridMetrics.gridCardWidth`（列间距 `gridMetrics.GRID_GAP`）。
 */
export const GRID_CARD = {
  /** 方图圆角。 */
  coverRadius: radius.md,
  /** 标题行高（footnote）+ 与封面/上一行的间距。 */
  nameLineHeight: textVariants.footnote.lineHeight,
  nameGap: spacing[2],
  /** 副行行高（micro）+ 与标题的间距。 */
  metaLineHeight: textVariants.micro.lineHeight,
  metaGap: 2,
  /** 歌手卡：圆形头像尺寸与卡片下间距。 */
  artistAvatarSize: 72,
  artistCardBottom: spacing[4],
} as const;
