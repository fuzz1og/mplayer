/**
 * PROTOTYPE — 歌单详情页 hero 头部三种结构变体（wayfinder 布局重构）
 *
 * 问题：「详情页 hero 头部」具体长什么样？
 * 三个结构不同的变体，通过 /playlist/[id]?variant=A|B|C 切换：
 *   A 信息行头部（横向：封面+信息+播放按钮）
 *   B 沉浸式 hero（全宽封面背景 + 渐变遮罩 + 覆盖文字 + 悬浮播放按钮）
 *   C 卡片悬浮 hero（渐变背景 + 大圆角封面卡片 + 信息 + 大播放按钮）
 * 验收后：获胜变体折入正式代码，本文件整体移到 throwaway 分支。
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Image,
} from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Music2, Play, ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Playlist } from '../../stores/playlistStore';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { colors, radius, spacing, shadow, typography } from '../../theme/tokens';
import SongRow from '../SongRow';
import type { Song } from '@mplayer/core';

export type HeroVariant = 'A' | 'B' | 'C' | 'D';

const VARIANT_NAMES: Record<HeroVariant, string> = {
  A: '信息行头部',
  B: '沉浸式 Hero',
  C: '卡片悬浮 Hero',
  D: '全出血折叠 Hero',
};

const AnimatedArrowLeft = Animated.createAnimatedComponent(ArrowLeft);

/** 用户歌单没有封面：渐变占位 + 音符图标 */
function CoverPlaceholder({ size, radiusValue }: { size: number; radiusValue: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radiusValue,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Music2 size={size * 0.38} color={colors.textInverse} />
    </View>
  );
}

function formatCount(n: number): string {
  return `${n} 首`;
}

function playAll(playlist: Playlist) {
  if (playlist.songs.length === 0) return;
  usePlayerStore.getState().setQueue(playlist.songs, 0);
  playSong(playlist.songs[0]);
}

/* ═══════════ 变体 A：信息行头部（横向紧凑） ═══════════ */
export function VariantA({ playlist }: { playlist: Playlist }) {
  return (
    <View style={styles.vA}>
      <View style={styles.vAHeader}>
        <CoverPlaceholder size={112} radiusValue={radius.md} />
        <View style={styles.vAInfo}>
          <Text style={styles.vATitle} numberOfLines={2}>{playlist.name}</Text>
          <Text style={styles.vAMeta}>
            {formatCount(playlist.songs.length)} · {new Date(playlist.createdAt).toLocaleDateString('zh-CN')}
          </Text>
          <TouchableOpacity
            style={styles.playAllBtn}
            onPress={() => playAll(playlist)}
          >
            <Play size={16} color={colors.textInverse} />
            <Text style={styles.playAllText}>播放全部</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ═══════════ 变体 B：沉浸式 Hero（Apple Music 风） ═══════════ */
export function VariantB({ playlist }: { playlist: Playlist }) {
  return (
    <View style={styles.vB}>
      {/* 全宽封面背景 */}
      <View style={styles.vBCover}>
        <CoverPlaceholder size={400} radiusValue={0} />
        {/* 底部渐变遮罩：白到透明的模拟（用半透明白层叠加） */}
        <View style={styles.vBShade} />
      </View>
      {/* 浮动返回按钮（B 隐藏原生导航头，自绘返回） */}
      <TouchableOpacity style={styles.vBBack} onPress={() => router.back()} hitSlop={8}>
        <ArrowLeft size={22} color="#fff" />
      </TouchableOpacity>
      {/* 覆盖在渐变上的信息 */}
      <View style={styles.vBInfo}>
        <Text style={styles.vBTitle} numberOfLines={2}>{playlist.name}</Text>
        <Text style={styles.vBMeta}>{formatCount(playlist.songs.length)} 首</Text>
      </View>
      {/* 悬浮在封面与列表交界处的播放按钮 */}
      <TouchableOpacity
        style={styles.vBPlayFab}
        onPress={() => playAll(playlist)}
      >
        <Play size={20} color={colors.textInverse} fill={colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
}

/* ═══════════ 变体 C：卡片悬浮 Hero（Spotify 风） ═══════════ */
export function VariantC({ playlist }: { playlist: Playlist }) {
  return (
    <View style={styles.vC}>
      <View style={styles.vCHeader}>
        <CoverPlaceholder size={150} radiusValue={radius.lg} />
        <Text style={styles.vCTitle} numberOfLines={2}>{playlist.name}</Text>
        <Text style={styles.vCMeta}>{formatCount(playlist.songs.length)} 首</Text>
        <TouchableOpacity
          style={styles.vCPlayBtn}
          onPress={() => playAll(playlist)}
        >
          <Play size={18} color={colors.textInverse} fill={colors.textInverse} />
          <Text style={styles.vCPlayText}>播放全部</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ═══════════ 变体 D：全出血折叠 Hero（Apple Music 式） ═══════════
 * 顶部整块都是封面（出血到状态栏/安全区后面），返回按钮悬浮；
 * 下滑盖过封面后导航栏渐变为正常标题栏（出现标题），上滑恢复。 */
export function VariantD({
  playlist,
  onRemoveSong,
  onSwap,
}: {
  playlist: Playlist;
  onRemoveSong: (song: Song) => void;
  onSwap: (original: Song, swapped: Song) => void;
}) {
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [statusStyle, setStatusStyle] = useState<'light' | 'dark'>('light');

  const NAV_H = 52;
  const COVER_H = 300 + insets.top; // 全出血：含状态栏高度
  const collapseAt = COVER_H - NAV_H - insets.top; // 导航栏完全实心化的滚动点

  const navBg = scrollY.interpolate({
    inputRange: [0, collapseAt],
    outputRange: ['rgba(255,255,255,0)', colors.bgSurface],
    extrapolate: 'clamp',
  });
  const titleOpacity = scrollY.interpolate({
    inputRange: [collapseAt - 30, collapseAt],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const backColor = scrollY.interpolate({
    inputRange: [collapseAt - 30, collapseAt],
    outputRange: ['#FFFFFF', colors.textPrimary],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      setStatusStyle(value > collapseAt - 30 ? 'dark' : 'light');
    });
    return () => scrollY.removeListener(id);
  }, [collapseAt, scrollY]);

  const cover = playlist.songs[0]?.cover;

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={statusStyle} />

      {/* 全出血封面（绝对定位盖在顶部，含状态栏区域） */}
      <Animated.View style={[styles.dCover, { height: COVER_H }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.dCoverImg} resizeMode="cover" />
        ) : (
          <CoverPlaceholder size={COVER_H + 400} radiusValue={0} />
        )}
        {/* 底部白渐变（过渡到页面背景） */}
        <View style={styles.dShade} />
        {/* 封面上的歌单信息 */}
        <View style={styles.dTitleWrap}>
          <Text style={styles.dTitle} numberOfLines={2}>{playlist.name}</Text>
          <Text style={styles.dMeta}>{formatCount(playlist.songs.length)} 首</Text>
        </View>
      </Animated.View>

      {/* 悬浮导航栏：透明 → 实心，返回按钮白 → 深色，标题淡入 */}
      <Animated.View
        style={[
          styles.dNav,
          { paddingTop: insets.top, height: NAV_H + insets.top, backgroundColor: navBg },
        ]}
      >
        <TouchableOpacity style={styles.dNavBack} onPress={() => router.back()} hitSlop={8}>
          <AnimatedArrowLeft size={22} color={backColor} />
        </TouchableOpacity>
        <Animated.Text style={[styles.dNavTitle, { opacity: titleOpacity }]} numberOfLines={1}>
          {playlist.name}
        </Animated.Text>
      </Animated.View>

      {/* 列表：内容从封面底部开始，滚动驱动折叠 */}
      <Animated.FlatList
        data={playlist.songs}
        keyExtractor={(item) => item.id}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: COVER_H, paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={styles.dPlayRow}>
            <TouchableOpacity style={styles.dPlayBtn} onPress={() => playAll(playlist)}>
              <Play size={18} color={colors.textInverse} fill={colors.textInverse} />
              <Text style={styles.dPlayText}>播放全部</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={1} onLongPress={() => onRemoveSong(item)}>
            <SongRow song={item} showSource queueSongs={playlist.songs} onSwap={onSwap} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

/* ═══════════ 悬浮切换条（仅 dev） ═══════════ */
export function PrototypeSwitcher({ current }: { current: HeroVariant }) {
  const cycle = (dir: 1 | -1) => {
    const keys: HeroVariant[] = ['A', 'B', 'C', 'D'];
    const idx = keys.indexOf(current);
    const next = keys[(idx + dir + keys.length) % keys.length];
    router.setParams({ variant: next });
  };

  return (
    <View style={styles.switcher} pointerEvents="box-none">
      <View style={styles.switcherBar}>
        <TouchableOpacity onPress={() => cycle(-1)} style={styles.switcherBtn} hitSlop={8}>
          <ChevronLeft size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.switcherLabel}>{current} — {VARIANT_NAMES[current]}</Text>
        <TouchableOpacity onPress={() => cycle(1)} style={styles.switcherBtn} hitSlop={8}>
          <ChevronRight size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* A */
  vA: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  vAHeader: { flexDirection: 'row', alignItems: 'center' },
  vAInfo: { flex: 1, marginLeft: spacing[4] },
  vATitle: { color: colors.textPrimary, fontSize: typography.sizes.xl, fontWeight: '700' },
  vAMeta: { color: colors.textSecondary, fontSize: typography.sizes.sm, marginTop: spacing[1] },
  playAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    marginTop: spacing[3],
  },
  playAllText: { color: colors.textInverse, fontSize: typography.sizes.sm, fontWeight: '600' },

  /* B */
  vB: {},
  vBCover: {
    height: 380,
    overflow: 'hidden',
    borderRadius: radius.lg,
    marginHorizontal: spacing[3],
    marginTop: spacing[3],
  },
  vBShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    top: 200,
  },
  vBBack: {
    position: 'absolute',
    top: 14,
    left: 14,
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vBInfo: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  vBTitle: { color: colors.textPrimary, fontSize: typography.sizes['2xl'], fontWeight: '800' },
  vBMeta: { color: colors.textSecondary, fontSize: typography.sizes.sm, marginTop: spacing[1] },
  vBPlayFab: {
    position: 'absolute',
    right: spacing[5],
    bottom: 64,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },

  /* C */
  vC: { paddingTop: spacing[4] },
  vCHeader: { alignItems: 'center', paddingHorizontal: spacing[5] },
  vCTitle: {
    color: colors.textPrimary,
    fontSize: typography.sizes['2xl'],
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing[4],
  },
  vCMeta: { color: colors.textSecondary, fontSize: typography.sizes.sm, marginTop: spacing[1] },
  vCPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[3],
    borderRadius: radius.full,
    marginTop: spacing[5],
  },
  vCPlayText: { color: colors.textInverse, fontSize: typography.sizes.base, fontWeight: '600' },

  /* D */
  dCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  dCoverImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 140,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  dTitleWrap: {
    position: 'absolute',
    left: spacing[5],
    right: spacing[5],
    bottom: spacing[4],
  },
  dTitle: { color: colors.textPrimary, fontSize: typography.sizes['3xl'], fontWeight: '800' },
  dMeta: { color: colors.textSecondary, fontSize: typography.sizes.sm, marginTop: spacing[1] },
  dNav: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    zIndex: 5,
  },
  dNavBack: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dNavTitle: {
    flex: 1,
    marginRight: spacing[6],
    textAlign: 'center',
    color: colors.textPrimary,
    fontSize: typography.sizes.lg,
    fontWeight: '600',
  },
  dPlayRow: { paddingHorizontal: spacing[5], paddingBottom: spacing[3] },
  dPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.accent,
    paddingVertical: spacing[3],
    borderRadius: radius.full,
    marginTop: spacing[2],
  },
  dPlayText: { color: colors.textInverse, fontSize: typography.sizes.base, fontWeight: '600' },

  /* switcher */
  switcher: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 90,
    alignItems: 'center',
  },
  switcherBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,40,0.9)',
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    gap: spacing[2],
    ...shadow.lg,
  },
  switcherBtn: { padding: spacing[1] },
  switcherLabel: { color: '#fff', fontSize: typography.sizes.sm, fontWeight: '600', minWidth: 150, textAlign: 'center' },
});

/** 原型入口（仅渲染当前变体；切换条由页面单独挂悬浮层） */
export function PlaylistHeroPrototype({ playlist, variant }: { playlist: Playlist; variant: HeroVariant }) {
  return (
    <>
      {variant === 'A' && <VariantA playlist={playlist} />}
      {variant === 'B' && <VariantB playlist={playlist} />}
      {variant === 'C' && <VariantC playlist={playlist} />}
    </>
  );
}
