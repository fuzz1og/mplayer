import { radius, spacing, textVariants } from '../theme/tokens';

/**
 * 发现页榜单 tab 的「分组卡片」布局度量 —— **单一事实源**（#416）。
 * 榜单 tab 不是一张平铺歌曲列表，而是若干张 `SectionCard`（iOS inset grouped）：卡片自带左右外边距
 * 与圆角，卡内是「标题行 + 5 首歌」。
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
