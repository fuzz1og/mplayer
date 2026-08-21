import { useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeColors } from '../theme/tokens';

interface Props {
  message?: string;
}

export default function LoadingState({ message = '加载中...' }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.accent} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgBase,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 10,
  },
});
