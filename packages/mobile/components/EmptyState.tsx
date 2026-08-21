import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors, spacing, textVariants } from '../theme/tokens';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}

export default function EmptyState({ icon, title, subtitle }: Props) {
  const Icon = icon;
  return (
    <View style={styles.container}>
      <Icon size={64} color={colors.textDisabled} />
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: colors.textTertiary,
    marginTop: 6,
  },
});
