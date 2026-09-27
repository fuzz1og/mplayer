import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import {spacing, textVariants} from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeColors } from '../theme/tokens';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** 可选动作槽（#406 一期）：空/错态从「句号」变成「邀请」（重试 / 返回） */
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, subtitle, action }: Props) {
  const Icon = icon;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <Icon size={64} color={colors.textDisabled} />
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {action ? <View style={styles.action}>{action}</View> : null}
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
    marginTop: 6,
  },
  action: { marginTop: spacing[5] },
});
