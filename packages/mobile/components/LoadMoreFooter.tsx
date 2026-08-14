import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme/tokens';

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
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      )}
      {!hasMore && hasData && <Text style={styles.doneText}>— 已加载全部 —</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingVertical: spacing[6],
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  doneText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
});
