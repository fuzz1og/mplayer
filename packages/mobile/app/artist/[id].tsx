import { useEffect, useState } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { musicApi, type Song } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import SongRow from '../../components/SongRow';

export default function ArtistDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [artist, setArtist] = useState<any>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const results = await musicApi.searchNeteaseArtists(id, 1);
      if (cancelled) return;
      const a = results[0] || null;
      if (a) setArtist({ ...a, id: a.id });
      if (a?.name) {
        const s = await musicApi.searchSongs(a.name, 1, 'netease');
        if (!cancelled) setSongs(s);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <LoadingState />;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: artist?.name || '歌手', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
      <FlatList
        data={songs}
        keyExtractor={(item, i) => `${item.id}-${i}`}
        ListHeaderComponent={() => (
          <View style={styles.header}>
            {artist?.cover ? (
              <Image source={{ uri: artist.cover }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: '#2a2a4a', justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ color: '#666', fontSize: 40, fontWeight: '700' }}>
                  {(artist?.name || '?')[0]}
                </Text>
              </View>
            )}
            <Text style={styles.name}>{artist?.name || '未知歌手'}</Text>
            {songs.length > 0 && <Text style={styles.subtitle}>共 {songs.length} 首歌曲</Text>}
          </View>
        )}
        renderItem={({ item }) => <SongRow song={item} showSource />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<View style={styles.empty}><Text style={{ color: '#666', fontSize: 16 }}>暂无歌曲</Text></View>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  avatar: { width: 120, height: 120, borderRadius: 60, marginBottom: 16 },
  name: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#888', fontSize: 13, marginTop: 6 },
  list: { paddingBottom: 100 },
  empty: { paddingVertical: 60, alignItems: 'center' },
});
