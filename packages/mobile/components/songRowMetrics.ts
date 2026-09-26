import { StyleSheet } from 'react-native';
import { radius, spacing, textVariants } from '../theme/tokens';

/**
 * 歌曲行的布局度量 —— **单一事实源**（#416）。
 *
 * 为什么单独成模块：真实行（`SongRow` 与发现页榜单 SectionCard 的歌曲行）与一切
 * 「镜像歌曲行」的骨架屏必须从**同一份**取数。此前：
 * - `SongListSkeleton` 注释声称「行高/间距与 SongRow 一致」，实际是
 *   `paddingVertical: spacing[2]`(8) 对真实的 10、没有分隔线、没有右侧两列图标
 *   → 每行矮 4dp 且歌名可用宽度不同，**数据到达时必跳版**；
 * - 两处真实行自己也不一致：封面与文字的间距 `SongRow` 用 `spacing[3]`(12)、
 *   发现页榜单行写死 10 —— 同一种行两个值。
 *
 * 纪律：**这些数值只在本文件定义**。骨架里再出现 44 / 10 / 12 / 28 这类字面量即为漂移
 * （`__tests__/loadingSkeletonParity.test.ts` 有源码级守卫）。
 */

const paddingVertical = 10;
const coverSize = 44;

export const SONG_ROW = {
  /** 行横向内距（页面沟槽 16，与节标题同轴）。 */
  paddingHorizontal: spacing[4],
  /** 行纵向内距。 */
  paddingVertical,
  /** 封面。 */
  coverSize,
  coverRadius: radius.sm,
  /** 封面与文字列的间距。发现页榜单行原为 10，统一到 token（12）。 */
  coverGap: spacing[3],
  /** 榜位序号列（发现页榜单行 / 歌单序号）。 */
  rankWidth: 28,
  rankGap: spacing[1],
  /** 文字列右间距：给右侧动作列让位。 */
  infoGap: spacing[2],
  /** 歌名 / 歌手行高 —— 从 textVariants 派生，骨架条与真文本同高。 */
  nameLineHeight: textVariants.subhead.lineHeight,
  artistLineHeight: textVariants.caption.lineHeight,
  /** 歌名与歌手之间的间距。 */
  artistGap: 2,
  /**
   * 来源徽章占位（`SongRow showSource`）：`SourceBadge` badge 形态是
   * 「文字 micro 行高 14 + paddingVertical 2×2 = 18 高」，宽随源名 2–3 字变化（≈44）。
   * 它夹在信息列与动作列之间，**占宽会改变歌名可用宽度**，所以骨架必须一起占位。
   */
  sourceBadgeWidth: 44,
  sourceBadgeHeight: 18,
  /** 右侧动作列：收藏 + 更多（图标尺寸 / 触控内距 / 两钮间距）。 */
  actionIconSize: 20,
  actionIconSizeCompact: 18,
  actionPadding: spacing[1],
  actionGap: spacing[1],
  /** 行分隔线宽度（发丝线）。 */
  separatorWidth: StyleSheet.hairlineWidth,
} as const;
