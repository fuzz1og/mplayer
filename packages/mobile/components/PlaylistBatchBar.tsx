import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Download, Heart, ListMusic, Trash2 } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { opacity, spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import ScalePress from './ScalePress';

/**
 * 选择模式的底部操作条（#490）：批量加入歌单 / 下载 / 移除 / 收藏。
 *
 * 「批量收藏」保持独立一项（票面明确）：收藏是一等目的地（有自己的 tab），
 * 一次点击 vs 开选择器，不并入「加入歌单」。
 *
 * 位置：由页面**紧贴**放在 BottomSafePlayerBar 之前（普通流式子节点），
 * 因此两者上下相接、不重叠，也不吃底部安全区（安全区仍归播放栏）。
 */
export default function PlaylistBatchBar({
  count,
  onAddToPlaylist,
  onDownload,
  onRemove,
  onFavorite,
}: {
  count: number;
  onAddToPlaylist: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onFavorite: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 一行都没选时四个动作都是空操作：整条压暗并禁用，别让用户点了没反应
  const disabled = count === 0;

  const items: { key: string; icon: LucideIcon; label: string; onPress: () => void; danger?: boolean }[] = [
    { key: 'playlist', icon: ListMusic, label: '加入歌单', onPress: onAddToPlaylist },
    { key: 'download', icon: Download, label: '下载', onPress: onDownload },
    { key: 'remove', icon: Trash2, label: '移除', onPress: onRemove, danger: true },
    { key: 'favorite', icon: Heart, label: '收藏', onPress: onFavorite },
  ];

  return (
    <View style={styles.bar}>
      {items.map(({ key, icon: Icon, label, onPress, danger }) => (
        <ScalePress
          key={key}
          style={[styles.item, disabled && styles.itemDisabled]}
          pressScaleTo={0.94}
          disabled={disabled}
          onPress={onPress}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Icon size={22} color={danger ? colors.dangerText : colors.textPrimary} />
          <Text style={[styles.label, danger && styles.labelDanger]}>{label}</Text>
        </ScalePress>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[1],
    gap: 2,
  },
  itemDisabled: { opacity: opacity.disabled },
  label: { ...textVariants.micro, color: colors.textSecondary },
  labelDanger: { color: colors.dangerText },
});
