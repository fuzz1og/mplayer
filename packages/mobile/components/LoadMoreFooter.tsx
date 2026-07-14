import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

interface Props {
  loadingMore: boolean;
  hasMore: boolean;
  hasData: boolean;
}

export default function LoadMoreFooter({ loadingMore, hasMore, hasData }: Props) {
  if (!hasData) return null;
  return (
    <View style={styles.footer}>
      {loadingMore && (
        <View style={styles.row}>
          <ActivityIndicator size="small" color="#e74c3c" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      )}
      {!hasMore && hasData && <Text style={styles.doneText}>— 已加载全部 —</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#888',
    fontSize: 13,
  },
  doneText: {
    color: '#555',
    fontSize: 13,
  },
});
