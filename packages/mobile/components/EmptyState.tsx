import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import {radius, spacing, textVariants} from '../theme/tokens';
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
}

export default function EmptyState({ icon, title, subtitle, action, actionLabel, onAction }: Props) {
  const Icon = icon;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <Icon size={64} color={colors.textDisabled} />
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {action ? (
        <View style={styles.action}>{action}</View>
      ) : actionLabel && onAction ? (
        <ScalePress style={styles.actionBtn} onPress={onAction} accessibilityLabel={actionLabel}>
          <Text style={styles.actionBtnText}>{actionLabel}</Text>
        </ScalePress>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgBase,
    paddingBottom: 80,
  },
  title: {
    ...textVariants.callout,
    color: colors.textSecondary,
    marginTop: spacing[3],
  },
  subtitle: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    marginTop: spacing[1] + 2,
  },
  action: { marginTop: spacing[5] },
  actionBtn: {
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
