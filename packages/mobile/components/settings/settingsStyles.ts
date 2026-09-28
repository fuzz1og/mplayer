import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {opacity, radius, shadow, spacing, textVariants} from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * 设置页共享样式（#425 拆段）：区段各成自治组件后，样式仍只有**这一个定义点**——
 * 各区段 import 本模块，不把同一份度量抄进 8 个文件（#416「同形/同源」约定）。
 */
export const makeSettingsStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  /* 外观：iOS 13+ 默认分段控件 cell——控件铺满、垂直居中紧凑（~60pt cell） */
  segmentCell: {
    paddingHorizontal: spacing[4],
    paddingVertical: 10,
  },
  /* iOS 13+ 分段控件默认：极浅灰底（segmentTrack）+ 选中段白胶囊浮起 */
  segmentGroup: {
    flexDirection: 'row',
    backgroundColor: colors.segmentTrack,
    borderRadius: radius.sm,
    padding: 2,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.xs,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.bgElevated,
    ...shadow.xs,
  },
  segmentBtnText: {
    color: colors.textSecondary,
    ...textVariants.subhead,
    fontWeight: '500',
  },
  segmentBtnTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[8], // iOS inset grouped 节间距 ~32pt（原 24 偏紧）
  },
  /* iOS inset grouped：节标题 13pt 灰色大写（uppercase secondary label）；
     白组坐灰底、组圆角 10pt（radius.md）、无阴影无边框；水平缩进 16（spacing[4]） */
  sectionLabel: {
    ...textVariants.settingsHeader,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  /* iOS 组下脚注：13pt 灰（secondary label） */
  sectionFootnote: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    marginTop: spacing[2],
  },
  group: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md, // iOS 组圆角 10pt（原 lg=16 偏大）
    overflow: 'hidden',
  },
  /* 同节多个小组之间的间距（iOS 同域小组惯例 8pt） */
  groupGap: {
    marginTop: spacing[2],
  },
  groupPad: {
    padding: spacing[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  rowSep: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  /* 操作行：iOS 设置操作 cell 文字居中（accent 主操作 / 破坏性红），图标+文字整体居中 */
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  /* iOS 操作行：17pt accent（settingsPrimary） */
  actionRowText: {
    ...textVariants.settingsPrimary,
    color: colors.accent,
  },
  actionRowDisabled: {
    opacity: opacity.disabledStrong,
  },
  /* 立即更新保留填充按钮：版本可用是低频且重要的主操作，值得视觉强调 */
  updateBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: spacing[3],
  },
  updateBtnText: {
    color: colors.textInverse,
    ...textVariants.subhead,
    fontWeight: '600',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textTertiary,
    marginRight: 10,
  },
  statusDotReady: {
    backgroundColor: colors.success,
  },
  /* iOS cell：主标题 17pt（settingsPrimary），值 13pt（settingsTertiary） */
  modeLabel: {
    ...textVariants.settingsPrimary,
    color: colors.textPrimary,
    flex: 1,
  },
  /* Switch 行：iOS cell 44pt（31 Switch + 13 padding ≈ 44），独立于通用 row 避免全局改动 */
  rowSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 6,
  },
  /* Android Material Switch 默认 48dp 偏高：wrap 固定 31（iOS UISwitch 高度）收敛布局占位 */
  switchWrap: {
    height: 31,
    justifyContent: 'center',
  },
  /* 视觉再缩 0.65 → 48dp × 0.65 ≈ 31pt，与 iOS UISwitch 观感一致 */
  switch: {
    transform: [{ scale: 0.65 }],
  },
  modeStatus: {
    ...textVariants.settingsTertiary,
    color: colors.textSecondary,
  },
  // ADR-0006：success 当文字仅 ≈2.3:1，走 successText 达标
  modeStatusReady: {
    color: colors.successText,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    color: colors.textPrimary,
    ...textVariants.subhead,
    fontWeight: '400',
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
  },

  /* 播放诊断（#363）：紧凑 trace 卡片 */
  diagHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  diagEmpty: {
    ...textVariants.settingsTertiary,
    color: colors.textSecondary,
    paddingVertical: spacing[2],
  },
  diagItem: {
    paddingVertical: spacing[2],
  },
  diagItemSep: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  diagSong: {
    ...textVariants.settingsSecondary,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing[2],
  },
  diagLayer: {
    ...textVariants.micro,
    color: colors.accent,
  },
  diagLayerFail: {
    color: colors.dangerText,
  },
  diagMeta: {
    ...textVariants.settingsTertiary,
    color: colors.textSecondary,
    marginTop: 2,
  },
  diagReason: {
    ...textVariants.settingsTertiary,
    color: colors.textTertiary,
    marginTop: 2,
  },
  diagSources: {
    ...textVariants.settingsTertiary,
    color: colors.textTertiary,
    marginTop: 2,
  },

  /* 缓存管理 */
  btnIcon: {
    marginRight: 6,
  },
  cacheStatsText: {
    color: colors.textSecondary,
    ...textVariants.footnote,
    textAlign: 'center',
  },
  cacheBarWrap: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bgHover,
    overflow: 'hidden',
    marginTop: spacing[3],
  },
  cacheBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  // ADR-0006：success 当文字走 successText 达标
  updateAvailableText: {
    color: colors.successText,
    ...textVariants.body,
    fontWeight: '600',
    marginBottom: spacing[2],
  },
  releaseNotes: {
    ...textVariants.settingsTertiary,
    color: colors.textSecondary,
    marginBottom: spacing[3],
    lineHeight: 20,
  },
});

/** 随主题取样式（colors 不变则复用，与拆段前页面的 useMemo 口径一致） */
export function useSettingsStyles() {
  const { colors } = useTheme();
  return useMemo(() => makeSettingsStyles(colors), [colors]);
}
