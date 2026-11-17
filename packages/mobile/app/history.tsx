import { View, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import SongList from '../components/SongList';
import type { SongListRow } from '../components/SongList';
import EmptyState from '../components/EmptyState';
import ScalePress from '../components/ScalePress';
import { Clock, Trash2 } from 'lucide-react-native';
import BottomSafePlayerBar from '../components/BottomSafePlayerBar';
import { useHistoryStore } from '../stores/historyStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import { useCallback, useMemo } from 'react';
import type { Song } from '@mplayer/core';
import { spacing } from '../theme/tokens';
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

  // 原生 header 已显示页名，列表里不再放重复的「播放历史」标题行。
  // 清空是破坏性操作：放 headerRight，先确认再执行。
  const handleClear = useCallback(() => {
    Alert.alert('清空播放历史', '将移除全部播放记录，此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: clearHistory },
    ]);
  }, [clearHistory]);

  // 行 key 用**歌曲 id**，不拼 index（#411）：historyStore 按 id 去重，
  // 此前 `${id}-${index}` 会让「删掉一项」把它后面所有行全部重挂载。
  const rows = useMemo<SongListRow[]>(
    () => history.map((song) => ({ kind: 'song' as const, key: song.id, song, showSource: true })),
    [history],
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
          headerRight: history.length > 0
            ? () => (
              <ScalePress
                style={styles.clearBtn}
                onPress={handleClear}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="清空播放历史"
              >
                <Trash2 size={20} color={colors.textSecondary} />
              </ScalePress>
            )
            : undefined,
        }} />
        {history.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="还没有播放记录"
            subtitle="播放任意歌曲后会出现在这里"
            actionLabel="去发现音乐"
            onAction={() => router.replace('/')}
          />
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
  // 页名与清空都交给原生 header；列表直接从歌曲行开始。
  clearBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
  },
  list: {},
});
