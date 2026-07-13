import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SongRow from '../../components/SongRow';
import EmptyState from '../../components/EmptyState';
import { useHistoryStore } from '../../stores/historyStore';
import { usePlayerStore } from '../../stores/playerStore';

export default function HistoryPage() {
  const { history, clearHistory } = useHistoryStore();

  const handlePlay = (index: number) => {
    if (history.length === 0) return;
    usePlayerStore.getState().setQueue(history, index);
  };

  if (history.length === 0) {
    return <EmptyState icon="time-outline" title="还没有播放记录" />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>播放历史</Text>
        <TouchableOpacity onPress={clearHistory} style={styles.clearBtn}>
          <Ionicons name="trash-outline" size={18} color="#e74c3c" />
          <Text style={styles.clearText}>清空</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={history}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item, index }) => (
          <SongRow
            song={item}
            showSource
            onPress={() => handlePlay(index)}
          />
        )}
        contentContainerStyle={styles.list}
      />
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
  list: { paddingBottom: 100 },
});
