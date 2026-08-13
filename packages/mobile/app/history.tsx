import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
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
import { colors, spacing, statusBarStyle } from '../theme/tokens';

export default function HistoryPage() {
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
        <StatusBar style={statusBarStyle} />
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
                <TouchableOpacity onPress={clearHistory} style={styles.clearBtn}>
                  <Text style={styles.clearText}>清空</Text>
                </TouchableOpacity>
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

const styles = StyleSheet.create({
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
    fontSize: 16,
    fontWeight: '600',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearText: {
    color: colors.dangerText,
    fontSize: 14,
  },
  list: {},
});
