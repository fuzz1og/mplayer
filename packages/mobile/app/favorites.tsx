import { View, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import SongRow from '../components/SongRow';
import EmptyState from '../components/EmptyState';
import PlayerBar from '../components/PlayerBar';
import { useFavoriteStore } from '../stores/favoriteStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';

export default function FavoritesPage() {
  const { favorites } = useFavoriteStore();

  const handlePlay = (index: number) => {
    if (favorites.length === 0) return;
    usePlayerStore.getState().setQueue(favorites, index);
    const song = favorites[index];
    if (song) playSong(song);
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <StatusBar style="light" />
        <Stack.Screen options={{
          title: '我的收藏',
          headerShown: true,
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          headerShadowVisible: false,
        }} />
        {favorites.length === 0 ? (
          <EmptyState icon="heart-outline" title="还没有收藏歌曲" />
        ) : (
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
        )}
      </SafeAreaView>
      <PlayerBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  list: {},
});
