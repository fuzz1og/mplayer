import { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSearchStore } from '../../stores/searchStore';
import { useSourceStore } from '../../stores/sourceStore';
import SongRow from '../../components/SongRow';
import LoadMoreFooter from '../../components/LoadMoreFooter';

export default function SearchPage() {
  const params = useLocalSearchParams<{ q: string }>();
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  const results = useSearchStore((s) => s.results);
  const loading = useSearchStore((s) => s.loading);
  const loadingMore = useSearchStore((s) => s.loadingMore);
  const hasMore = useSearchStore((s) => s.hasMore);
  const error = useSearchStore((s) => s.error);
  const search = useSearchStore((s) => s.search);
  const loadMore = useSearchStore((s) => s.loadMore);
  const query = useSearchStore((s) => s.query);
  const source = useSourceStore((s) => s.selectedSource);

  useEffect(() => {
    if (q && q !== query) {
      search(q);
    }
  }, [q]);

  // 切换源时重新搜索
  useEffect(() => {
    if (q) search(q);
  }, [source]);

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator color="#e74c3c" style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
          <Text style={[styles.emptyText, { color: '#e74c3c' }]}>{error}</Text>
        </View>
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.key}
          renderItem={({ item: group }) => (
            <View style={styles.groupSection}>
              <Text style={styles.groupHeader}>
                {group.name}
                {group.artist ? <Text style={styles.groupArtist}> — {group.artist}</Text> : null}
              </Text>
              {group.songs.map((song, i) => (
                <SongRow key={`${song.id}-${i}`} song={song} showSource queueSongs={group.songs} />
              ))}
            </View>
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={results.length > 0} />}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="musical-notes-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>搜索歌曲和歌手</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  groupSection: { marginBottom: 8 },
  groupHeader: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#16213e',
    marginTop: 8,
    marginHorizontal: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  groupArtist: { color: '#666', fontWeight: '400' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: { color: '#444', fontSize: 16, marginTop: 12 },
});
