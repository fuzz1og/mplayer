import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import SongRow from '../components/SongRow';
import EmptyState from '../components/EmptyState';
import PlayerBar from '../components/PlayerBar';
import { useHistoryStore } from '../stores/historyStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';

export default function HistoryPage() {
  const { history, clearHistory } = useHistoryStore();

  const handlePlay = (index: number) => {
    if (history.length === 0) return;
    usePlayerStore.getState().setQueue(history, index);
    const song = history[index];
    if (song) playSong(song);
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <StatusBar style="light" />
        <Stack.Screen options={{
          title: '播放历史',
          headerShown: true,
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          headerShadowVisible: false,
        }} />
        {history.length === 0 ? (
          <EmptyState icon="time-outline" title="还没有播放记录" />
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
              />
            )}
            contentContainerStyle={styles.list}
          />
        )}
      </SafeAreaView>
      <PlayerBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearText: {
    color: '#e74c3c',
    fontSize: 14,
  },
  list: {},
});
