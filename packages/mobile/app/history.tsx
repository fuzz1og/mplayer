import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import SongList from '../components/SongList';
import type { SongListRow } from '../components/SongList';
import EmptyState from '../components/EmptyState';
import { Clock } from 'lucide-react-native';
import BottomSafePlayerBar from '../components/BottomSafePlayerBar';
import { useHistoryStore } from '../stores/historyStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import { useCallback, useMemo } from 'react';
import type { Song } from '@mplayer/core';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

export default function HistoryPage() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 选择器订阅（#411）：此前解构整个 store
  const history = useHistoryStore((s) => s.history);
  const removeHistory = useHistoryStore((s) => s.removeHistory);
  const clearHistory = useHistoryStore((s) => s.clearHistory);

  const handlePlay = useCallback(
    (song: Song) => {
      const index = history.findIndex((s) => s.id === song.id);
      if (index < 0) return;
      usePlayerStore.getState().setQueue(history, index);
      playSong(song);
    },
    [history],
  );

  const handleRemove = useCallback((song: Song) => removeHistory(song.id), [removeHistory]);

  const headerAction = useMemo(() => ({ label: '清空', onPress: clearHistory, danger: true }), [clearHistory]);

  // 行 key 用**歌曲 id**，不拼 index（#411）：historyStore 按 id 去重，
  // 此前 `${id}-${index}` 会让「删掉一项」把它后面所有行全部重挂载。
  const rows = useMemo<SongListRow[]>(
    () => [
      { kind: 'sectionHeader', key: 'header', title: '播放历史', action: headerAction },
      ...history.map((song) => ({ kind: 'song' as const, key: song.id, song, showSource: true })),
    ],
    [history, headerAction],
  );

  return (
    <View style={styles.container}>
      {/* 原生 header 已含状态栏区域，SafeAreaView 再加 top 会叠出空白 */}
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack.Screen options={{
          title: '播放历史',
          headerShown: true,
          headerStyle: { backgroundColor: colors.bgSurface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }} />
        {history.length === 0 ? (
          <EmptyState icon={Clock} title="还没有播放记录" />
        ) : (
          <SongList
            rows={rows}
            onPress={handlePlay}
            onRemove={handleRemove}
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
  // 表头（title + 清空）已改为列表里的 sectionHeader 行（#411）：
  // 用 ListHeaderComponent 会让 getItemLayout 的偏移语义与表头高度打架，而它是固定行高的。
  list: {},
});
