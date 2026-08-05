import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}

export default function EmptyState({ icon, title, subtitle }: Props) {
  const Icon = icon;
  return (
    <View style={styles.container}>
      <Icon size={64} color="#444" />
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
    backgroundColor: '#1a1a2e',
    paddingBottom: 80,
  },
  title: {
    color: '#888',
    fontSize: 16,
    marginTop: 12,
  },
  subtitle: {
    color: '#555',
    fontSize: 13,
    marginTop: 6,
  },
});
