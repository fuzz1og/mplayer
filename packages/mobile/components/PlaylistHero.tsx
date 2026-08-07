/**
 * 歌单详情页 Hero — 全出血折叠方案（原型 D 变体定稿）
 *
 * 结构（自上而下）：
 *   1. 大封面全出血到状态栏/灵动岛安全区后面，随列表滚动滚出屏幕
 *   2. 悬浮导航栏：顶部透明（盖在封面上）→ 下滑盖过封面后逐渐变为
 *      实心正常标题栏（标题淡入、返回按钮变深色），上滑恢复
 *   3. 信息区在封面下方独立实心区域（不叠封面、不透明）
 *   4. 歌曲列表带表头（歌曲 / 操作），行操作 = 收藏 + 更多
 *
 * 封面来源规则（用户确认）：
 *   自建歌单 → 第一首歌封面（过期则占位等待重新搜索后的最新封面）
 *   空歌单/无图 → 默认渐变占位兜底
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import { Music2, Play, ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Playlist } from '../stores/playlistStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import { useRefreshedCover } from '../hooks/useRefreshedCover';
import { colors, radius, spacing, typography } from '../theme/tokens';
import SongRow from './SongRow';
import type { Song } from '@mplayer/core';

const AnimatedArrowLeft = Animated.createAnimatedComponent(ArrowLeft);

function formatCount(n: number): string {
  return `${n} 首`;
}

function playAll(playlist: Playlist) {
  if (playlist.songs.length === 0) return;
  usePlayerStore.getState().setQueue(playlist.songs, 0);
  playSong(playlist.songs[0]);
}

export default function PlaylistHero({
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

  // 自建歌单封面 = 第一首歌封面；过期则占位等待重新搜索后的最新封面
  const { cover, handleError } = useRefreshedCover(playlist.songs[0] || null);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={statusStyle} />

      {/* 悬浮导航栏：顶部透明（盖在封面上）→ 下滑后实心正常标题栏 */}
      <Animated.View
        style={[
          styles.nav,
          { paddingTop: insets.top, height: NAV_H + insets.top, backgroundColor: navBg },
        ]}
      >
        <TouchableOpacity style={styles.navBack} onPress={() => router.back()} hitSlop={8}>
          <AnimatedArrowLeft size={22} color={backColor} />
        </TouchableOpacity>
        <Animated.Text style={[styles.navTitle, { opacity: titleOpacity }]} numberOfLines={1}>
          {playlist.name}
        </Animated.Text>
      </Animated.View>

      {/* 列表：封面是列表第一块内容（含状态栏区域），随滚动滚出屏幕 */}
      <Animated.FlatList
        data={playlist.songs}
        keyExtractor={(item) => item.id}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View>
            {/* 全出血封面 */}
            <View style={{ height: COVER_H }}>
              {cover ? (
                <Image
                  source={{ uri: cover }}
                  style={styles.coverImg}
                  resizeMode="cover"
                  onError={handleError}
                />
              ) : (
                <View style={styles.coverFallback}>
                  <Music2 size={72} color={colors.textInverse} />
                </View>
              )}
            </View>
            {/* 信息区：封面下方独立实心区域（不叠封面、不透明） */}
            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={2}>{playlist.name}</Text>
              <Text style={styles.meta}>{formatCount(playlist.songs.length)} 首</Text>
              <TouchableOpacity style={styles.playBtn} onPress={() => playAll(playlist)}>
                <Play size={18} color={colors.textInverse} fill={colors.textInverse} />
                <Text style={styles.playText}>播放全部</Text>
              </TouchableOpacity>
            </View>
            {/* 歌曲列表表头：与行对齐（封面 44+12 偏移） */}
            <View style={styles.listHeader}>
              <Text style={styles.listHeaderSong}>歌曲</Text>
              <Text style={styles.listHeaderOps}>操作</Text>
            </View>
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

const styles = StyleSheet.create({
  coverImg: {
    width: '100%',
    height: '100%',
  },
  coverFallback: {
    flex: 1,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nav: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    zIndex: 5,
  },
  navBack: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    marginRight: spacing[6],
    textAlign: 'center',
    color: colors.textPrimary,
    fontSize: typography.sizes.lg,
    fontWeight: '600',
  },
  info: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
  },
  title: { color: colors.textPrimary, fontSize: typography.sizes['3xl'], fontWeight: '800' },
  meta: { color: colors.textSecondary, fontSize: typography.sizes.sm, marginTop: spacing[1] },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    marginTop: spacing[3],
  },
  playText: { color: colors.textInverse, fontSize: typography.sizes.base, fontWeight: '600' },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  listHeaderSong: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 56, // 对齐行内封面（44）+ 间距（12）
  },
  listHeaderOps: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
  },
});
