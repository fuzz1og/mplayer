import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

interface Props {
  message?: string;
}

export default function LoadingState({ message = '加载中...' }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.accent} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
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
