import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeColors } from '../theme/tokens';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}

export default function EmptyState({ icon, title, subtitle }: Props) {
  const Icon = icon;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <Icon size={64} color={colors.textDisabled} />
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
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
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: spacing[3],
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: 13,
    marginTop: 6,
  },
});
