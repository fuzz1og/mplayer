import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { radius, spacing, textVariants } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeColors } from '../theme/tokens';
import ScalePress from './ScalePress';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** 可选动作槽（#406 一期）：空/错态从「句号」变成「邀请」（重试 / 返回） */
  action?: React.ReactNode;
  /** 标准动作按钮（与 action 二选一）：空态给可行动入口，如「去搜索」「去发现」 */
  actionLabel?: string;
  onAction?: () => void;
  /** 标准动作按钮左侧图标（重试最常用） */
  actionIcon?: LucideIcon;
  /** 默认 textDisabled；错误态传 dangerText */
  iconColor?: string;
  /**
   * page = 整页空/错态（flex 填满）；embedded = 列表内嵌空/错态（不写 flex）。
   * 两者只在尺寸与留白上不同，标题/按钮/图标语义一致。
   */
  variant?: 'page' | 'embedded';
}

export default function EmptyState({
  icon,
  title,
  subtitle,
  action,
  actionLabel,
  onAction,
  actionIcon: ActionIcon,
  iconColor,
  variant = 'page',
}: Props) {
  const Icon = icon;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const embedded = variant === 'embedded';

  return (
    <View style={[styles.container, embedded ? styles.embedded : styles.page]}>
      <Icon size={embedded ? 28 : 64} color={iconColor ?? colors.textDisabled} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action ? (
        <View style={styles.action}>{action}</View>
      ) : actionLabel && onAction ? (
        <ScalePress style={styles.actionBtn} onPress={onAction} accessibilityLabel={actionLabel}>
          {ActionIcon ? <ActionIcon size={16} color={colors.textInverse} /> : null}
          <Text style={styles.actionBtnText}>{actionLabel}</Text>
        </ScalePress>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing[6],
  },
  page: {
    flex: 1,
    paddingBottom: 80,
  },
  embedded: {
    minHeight: 240,
    paddingVertical: spacing[10],
  },
  title: {
    ...textVariants.sectionHeader,
    color: colors.textPrimary,
    marginTop: spacing[3],
    textAlign: 'center',
  },
  subtitle: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    marginTop: spacing[1] + 2,
    textAlign: 'center',
  },
  action: { marginTop: spacing[5] },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[5],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  actionBtnText: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
