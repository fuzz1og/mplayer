import { View, FlatList, StyleSheet } from 'react-native';
import SongRow from '../../components/SongRow';
import EmptyState from '../../components/EmptyState';
import { useFavoriteStore } from '../../stores/favoriteStore';
import { usePlayerStore } from '../../stores/playerStore';

export default function FavoritesPage() {
  const { favorites } = useFavoriteStore();

  const handlePlay = (index: number) => {
    usePlayerStore.getState().setQueue(favorites, index);
  };

  if (favorites.length === 0) {
    return <EmptyState icon="heart-outline" title="还没有收藏歌曲" />;
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
});
