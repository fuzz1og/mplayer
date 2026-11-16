import { View, Text, StyleSheet } from 'react-native';
import { Music } from 'lucide-react-native';
import { COVER_SIZE } from '@mplayer/core';
import LazyCover from './LazyCover';
import ScalePress, { pressScale } from './ScalePress';
import { spacing, textVariants } from '../theme/tokens';
import { lightColors, darkColors } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { SONG_ROW } from './songRowMetrics';
import type { HotlistItem } from '../stores/discoverStore';

/**
 * 发现页榜单行度量 —— 基于 `songRowMetrics`（#416 单一事实源），
 * 只追加右侧时长列。骨架屏（HotlistSkeleton）从同一份取数。
 */
export const CHART_ROW = {
  /** 右侧时长列宽（等宽数字，最宽 `10:00`）。 */
  durationWidth: spacing[8],
  durationHeight: textVariants.caption.lineHeight,
  separatorWidth: SONG_ROW.separatorWidth,
} as const;

/** 秒 → `m:ss`；源未提供时长时给占位，不显示误导性的 0:00。 */
export function formatChartDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  item: HotlistItem;
  rank: number;
  onPress: () => void;
  separator?: 'none' | 'top';
}

/** 本地榜单行（不改 SongRow）：名次 + 封面 + 歌名/歌手 + 时长。 */
export default function ChartRow({ item, rank, onPress, separator = 'none' }: Props) {
  const { colors, isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;

  return (
    <ScalePress
      style={[styles.row, separator === 'top' && styles.separator]}
      pressScaleTo={pressScale.row}
      onPress={onPress}
      accessibilityLabel={`播放 ${item.name}，${item.artists}，第 ${rank} 名`}
    >
      <Text style={[styles.rank, rank <= 3 && { color: colors.rankText[rank - 1] }]}>
        {rank.toString().padStart(2, '0')}
      </Text>
      {item.cover ? (
        <LazyCover uri={item.cover} style={styles.cover} thumbSize={COVER_SIZE.row} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <Music size={18} color={colors.textDisabled} />
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.artist} numberOfLines={1}>{item.artists}</Text>
      </View>
      <Text style={styles.duration}>{formatChartDuration(item.duration)}</Text>
    </ScalePress>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SONG_ROW.paddingHorizontal,
    paddingVertical: SONG_ROW.paddingVertical,
  },
  separator: {
    borderTopWidth: CHART_ROW.separatorWidth,
    borderTopColor: colors.borderSubtle,
  },
  rank: {
    ...textVariants.caption,
    fontWeight: '600',
    // 名次是有效信息：不用装饰性的 textTertiary
    color: colors.textSecondary,
    width: SONG_ROW.rankWidth,
    textAlign: 'center',
    marginRight: SONG_ROW.rankGap,
    fontVariant: ['tabular-nums'],
  },
  cover: {
    width: SONG_ROW.coverSize,
    height: SONG_ROW.coverSize,
    borderRadius: SONG_ROW.coverRadius,
    marginRight: SONG_ROW.coverGap,
  },
  coverFallback: {
    backgroundColor: colors.bgHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, marginRight: SONG_ROW.infoGap },
  name: { ...textVariants.subhead, color: colors.textPrimary },
  artist: { ...textVariants.caption, color: colors.textSecondary, marginTop: SONG_ROW.artistGap },
  duration: {
    ...textVariants.caption,
    color: colors.textSecondary,
    width: CHART_ROW.durationWidth,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});

const STYLES = {
  light: makeStyles(lightColors),
  dark: makeStyles(darkColors),
};
