import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { AlertCircle, RefreshCw } from 'lucide-react-native';
import { radius, spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** 发现页空态 / 错态：文案 + 可行动入口（重试）。每个 tab 独立使用。 */
export default function DiscoverStateView({ title, message, actionLabel = '重试', onAction }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap}>
      <AlertCircle size={28} color={colors.textSecondary} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {onAction ? (
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => { void onAction(); }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <RefreshCw size={16} color={colors.textInverse} />
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 分页失败的轻量错误条（列表底部）：文案 + 重试，不打断已加载内容。 */
export function DiscoverInlineError({ message = '加载更多失败', onRetry }: { message?: string; onRetry: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.inline}>
      <Text style={styles.inlineText}>{message}</Text>
      <Pressable
        onPress={() => { void onRetry(); }}
        accessibilityRole="button"
        accessibilityLabel="重试加载更多"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.inlineAction}>重试</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    // 不写 flex:1：作为 FlatList 的 ListEmptyComponent 时父级高度不受限，flex 会塌成 0。
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[10],
    backgroundColor: colors.bgBase,
  },
  title: {
    ...textVariants.sectionHeader,
    color: colors.textPrimary,
    marginTop: spacing[3],
    textAlign: 'center',
  },
  message: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    marginTop: spacing[2],
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[5],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  buttonPressed: {
    backgroundColor: colors.accentHover,
  },
  buttonText: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.textInverse,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingVertical: spacing[4],
  },
  inlineText: {
    ...textVariants.footnote,
    color: colors.textSecondary,
  },
  inlineAction: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.accent,
  },
});
