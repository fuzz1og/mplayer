import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Play } from 'lucide-react-native';
import { COVER_SIZE } from '@mplayer/core';
import LazyCover from './LazyCover';
import ScalePress, { pressScale } from './ScalePress';
import { heroScrim, playerForeground, radius, spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import type { HotlistItem } from '../stores/discoverStore';

/**
 * 今日焦点 hero 度量 —— 骨架屏（HotlistSkeleton）从这里取同一份，加载完成不跳版。
 * Hero 是静态封面 + 静态渐变（不逐帧取色、不做实时模糊），只动 transform/opacity。
 */
export const DISCOVER_HERO = {
  height: 184,
  marginTop: spacing[2],
  marginHorizontal: spacing[4],
  radius: radius.lg,
  padding: spacing[4],
  playSize: spacing[12],
} as const;

interface Props {
  item: HotlistItem;
  sourceLabel: string;
  onPress: () => void;
}

export default function DiscoverHero({ item, sourceLabel, onPress }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fg = playerForeground.dark;

  return (
    <ScalePress
      style={styles.wrap}
      pressScaleTo={pressScale.row}
      onPress={onPress}
      accessibilityLabel={`今日焦点：${item.name}，${item.artists}，点按播放`}
    >
      <View style={StyleSheet.absoluteFill}>
        {item.cover ? (
          <LazyCover uri={item.cover} style={StyleSheet.absoluteFill} thumbSize={COVER_SIZE.hero} />
        ) : (
          <LinearGradient
            colors={[colors.bgElevated, colors.bgHover, colors.bgSurface]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* 固定深色遮罩（不跟主题走）：保证封面/浅色渐变上的白字与播放键对比度；
            静态渐变，不做实时模糊或逐帧取色 */}
        <LinearGradient
          colors={heroScrim}
          locations={[0, 0.45, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.copy}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>今日焦点 · {sourceLabel}</Text>
        </View>
        <Text style={[styles.title, { color: fg.primary }]} numberOfLines={2}>{item.name}</Text>
        <Text style={[styles.artist, { color: fg.secondary }]} numberOfLines={1}>{item.artists}</Text>
      </View>

      <View style={styles.play}>
        <Play size={20} color={colors.textInverse} fill={colors.textInverse} />
      </View>
    </ScalePress>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    height: DISCOVER_HERO.height,
    marginTop: DISCOVER_HERO.marginTop,
    marginHorizontal: DISCOVER_HERO.marginHorizontal,
    borderRadius: DISCOVER_HERO.radius,
    overflow: 'hidden',
    backgroundColor: colors.bgSurface,
    justifyContent: 'flex-end',
  },
  copy: {
    padding: DISCOVER_HERO.padding,
    paddingRight: DISCOVER_HERO.playSize + DISCOVER_HERO.padding + spacing[2],
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    // 与播放键同色：白字/深字都走 textInverse，双主题对比度可控
    backgroundColor: colors.accent,
  },
  pillText: {
    ...textVariants.micro,
    color: colors.textInverse,
  },
  title: {
    ...textVariants.titleLg,
    marginTop: spacing[2],
  },
  artist: {
    ...textVariants.footnote,
    marginTop: spacing[1],
  },
  play: {
    position: 'absolute',
    right: DISCOVER_HERO.padding,
    bottom: DISCOVER_HERO.padding,
    width: DISCOVER_HERO.playSize,
    height: DISCOVER_HERO.playSize,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
