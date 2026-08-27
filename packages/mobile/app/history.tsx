import { View, Text, FlatList, StyleSheet } from 'react-native';
import ScalePress from '../components/ScalePress';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import SongRow from '../components/SongRow';
import EmptyState from '../components/EmptyState';
import { Clock } from 'lucide-react-native';
import BottomSafePlayerBar from '../components/BottomSafePlayerBar';
import { useHistoryStore } from '../stores/historyStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import { useMemo } from 'react';
import {spacing, textVariants} from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

export default function HistoryPage() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { history, removeHistory, clearHistory } = useHistoryStore();

  const handlePlay = (index: number) => {
    if (history.length === 0) return;
    usePlayerStore.getState().setQueue(history, index);
    const song = history[index];
    if (song) playSong(song);
  };

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
          <FlatList
            data={history}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            ListHeaderComponent={
              <View style={styles.header}>
                <Text style={styles.headerTitle}>播放历史</Text>
                <ScalePress onPress={clearHistory} style={styles.clearBtn}>
                  <Text style={styles.clearText}>清空</Text>
                </ScalePress>
              </View>
            }
            renderItem={({ item, index }) => (
              <SongRow
                song={item}
                showSource
                onPress={() => handlePlay(index)}
                onRemove={(s) => removeHistory(s.id)}
              />
            )}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  headerTitle: {
    color: colors.textPrimary,
    ...textVariants.sectionHeader,
    fontWeight: '600',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearText: {
    color: colors.dangerText,
    ...textVariants.subhead,
    fontWeight: '400',
  },
  list: {},
});
