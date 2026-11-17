import { View, Text, StyleSheet, Pressable } from 'react-native';
import { spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

/**
 * 列表内联错误条：保留已加载内容，只在底部/区块内给一行重试。
 * 全页空/错态用 EmptyState；两者共用同一套文案层级与强调色。
 */
export default function InlineError({ message = '加载失败，点此重试', onRetry }: {
  message?: string;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.inline}>
      <Text style={styles.text}>{message}</Text>
      <Pressable
        onPress={() => { void onRetry(); }}
        accessibilityRole="button"
        accessibilityLabel="重试"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.action}>重试</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingVertical: spacing[4],
  },
  text: {
    ...textVariants.footnote,
    color: colors.textSecondary,
  },
  action: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.accent,
  },
});
