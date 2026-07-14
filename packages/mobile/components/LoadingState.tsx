import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

interface Props {
  message?: string;
}

export default function LoadingState({ message = '加载中...' }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color="#e74c3c" />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  message: {
    color: '#888',
    fontSize: 14,
    marginTop: 10,
  },
});
