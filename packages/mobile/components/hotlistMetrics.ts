import { radius, spacing, textVariants } from '../theme/tokens';

/**
 * 发现页榜单 tab 的「分组卡片」布局度量 —— **单一事实源**（#416）。
 *
 * 榜单 tab 不是一张平铺歌曲列表，而是若干张 `SectionCard`（iOS inset grouped）：
 * 卡片自带左右外边距与圆角，卡内是「标题行 + 5 首歌」。
 * 真实结构（`DiscoverTabs` 的 `section/sectionHeader` 与 `songs.slice(0, N)`）
 * 与骨架屏从同一份取数——此前该 tab 的 loading 直接复用**平铺**的
 * `SongListSkeleton`，卡片、标题行、缩进全都不存在，数据到达时整页重排。
 */
export const HOTLIST_SECTION = {
  /** 卡片：左右外边距（16pt 页面沟槽）、上间距、圆角。 */
  marginHorizontal: spacing[4],
  marginTop: spacing[5],
  radius: radius.lg,
  /** 卡内标题行。 */
  headerPaddingHorizontal: spacing[4],
  headerPaddingVertical: spacing[3],
  headerLineHeight: textVariants.sectionHeader.lineHeight,
  /** 每张卡预展示的歌曲数（真实页面同值，见 `songs.slice(0, HOTLIST_SECTION.previewRows)`）。 */
  previewRows: 5,
} as const;
