import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SongRow from '../../components/SongRow';
import { useFavoriteStore } from '../../stores/favoriteStore';
import { usePlayerStore } from '../../stores/playerStore';

export default function FavoritesPage() {
  const { favorites } = useFavoriteStore();

  const handlePlay = (index: number) => {
    usePlayerStore.getState().setQueue(favorites, index);
  };

  if (favorites.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="heart-outline" size={64} color="#555" />
        <Text style={styles.emptyText}>还没有收藏歌曲</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <SongRow
            song={item}
            showSource
            defaultFavorited
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
  list: { paddingBottom: 100 },
  emptyContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#888', fontSize: 16, marginTop: 12 },
});
