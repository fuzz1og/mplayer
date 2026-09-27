import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import SongList from '../components/SongList';
import type { SongListRow } from '../components/SongList';
import EmptyState from '../components/EmptyState';
import { Heart } from 'lucide-react-native';
import BottomSafePlayerBar from '../components/BottomSafePlayerBar';
import { useFavoriteStore } from '../stores/favoriteStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import type { Song } from '@mplayer/core';
import { useCallback, useMemo } from 'react';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

export default function FavoritesPage() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 选择器订阅（#411）：此前解构整个 store，任何字段变化都重渲染整页
  const favorites = useFavoriteStore((s) => s.favorites);
  const replaceSong = useFavoriteStore((s) => s.replaceSong);

  // 回调必须引用稳定，否则 SongRow 的 memo 会被逐帧击穿（#411）。
  // 所以对外只收 song、下标在这里现算——点击是低频操作，O(N) 不在意。
  const handlePlay = useCallback(
    (song: Song) => {
      const index = favorites.findIndex((s) => s.id === song.id);
      if (index < 0) return;
      usePlayerStore.getState().setQueue(favorites, index);
      playSong(song);
    },
    [favorites],
  );

  // 单曲换源后持久化到收藏（换源版本下次进收藏仍是新源）
  const handleSwap = useCallback(
    (original: Song, swapped: Song) => {
      replaceSong(original.id, swapped);
    },
    [replaceSong],
  );

  const rows = useMemo<SongListRow[]>(
    () => favorites.map((song) => ({ kind: 'song' as const, key: song.id, song, showSource: true })),
    [favorites],
  );

  return (
    <View style={styles.container}>
      {/* 原生 header 已含状态栏区域，SafeAreaView 再加 top 会叠出空白 */}
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack.Screen options={{
          title: '我的收藏',
          headerShown: true,
          headerStyle: { backgroundColor: colors.bgSurface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }} />
        {favorites.length === 0 ? (
          <EmptyState icon={Heart} title="还没有收藏歌曲" />
        ) : (
          <SongList
            rows={rows}
            onPress={handlePlay}
            onSwap={handleSwap}
            contentContainerStyle={styles.list}
          />
        )}
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  list: {},
});
