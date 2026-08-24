import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { SourceKey } from '@mplayer/core';
import { radius, sourceColors, spacing, textVariants } from '../theme/tokens';

/**
 * 音乐源身份的唯一视觉出口（源色纪律 #196 M2-3）：
 * 源品牌色只允许以「圆点徽章」或「文字徽章」两种形态出现，
 * 全部引用收敛在本组件单文件——其他组件物理上拿不到 sourceColors。
 *
 * - variant="dot"（默认）：纯色圆点。size: sm=6 / md=8 / lg=10（TopBar 来源钮、
 *   源选择弹层、换源弹层列表项）。
 * - variant="badge"：半透明底色 + 彩色文字（SongRow 来源徽章）。
 */
export default function SourceBadge({ source, size = 'md', variant = 'dot', style, children }: {
  source: SourceKey | 'all';
  /** dot 尺寸：sm=6 / md=8 / lg=10；badge 形态忽略 */
  size?: 'sm' | 'md' | 'lg';
  variant?: 'dot' | 'badge';
  style?: StyleProp<ViewStyle>;
  /** badge 形态的文案（如来源名）；dot 形态忽略 */
  children?: React.ReactNode;
}) {
  if (variant === 'badge') {
    return (
      <View style={[styles.badge, { backgroundColor: `${sourceColors[source]}14` }, style]}>
        <Text style={[styles.badgeText, { color: sourceColors[source] }]}>{children}</Text>
      </View>
    );
  }
  const dotSize = size === 'sm' ? 6 : size === 'lg' ? 10 : 8;
  return <View style={[styles.dot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: sourceColors[source] }, style]} />;
}

const styles = StyleSheet.create({
  dot: {},
  badge: {
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: spacing[2],
  },
  badgeText: {
    ...textVariants.micro,
  },
});
