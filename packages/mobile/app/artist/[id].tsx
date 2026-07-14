import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { musicApi, type Song } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import SongRow from '../../components/SongRow';
import PlayerBar from '../../components/PlayerBar';

export default function ArtistDetailPage() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [artist, setArtist] = useState<any>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const songTotalRef = useRef(0);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !id) return;
    setLoadingMore(true);
    try {
      const r = await musicApi.getNeteaseArtistSongs(id as string, songs.length, 50);
      if (r.songs.length > 0) {
        setSongs(prev => [...prev, ...r.songs]);
        setHasMore(songs.length + r.songs.length < r.total);
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[ArtistDetail] loadMore error:', e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, id, songs.length]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const artistName = name || id;
      const [artistResults, songResult] = await Promise.all([
        musicApi.searchNeteaseArtists(artistName, 1),
        musicApi.getNeteaseArtistSongs(id as string, 0, 50),
      ]);
      if (cancelled) return;
      setSongs(songResult.songs);
      songTotalRef.current = songResult.total;
      setHasMore(songResult.songs.length < songResult.total);
      const info = artistResults[0] || null;
      setArtist({ ...info, name: info?.name || artistName, picUrl: info?.picUrl || '' });
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, name]);

  if (loading) return <LoadingState />;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <StatusBar style="light" />
        <Stack.Screen options={{ title: artist?.name || '歌手', headerShown: true, headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
        <FlatList
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          ListHeaderComponent={() => (
            <View style={styles.header}>
              {artist?.picUrl ? (
                <Image source={{ uri: artist.picUrl }} style={styles.avatar} />
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
          renderItem={({ item }) => <SongRow song={item} showSource queueSongs={songs} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={songs.length > 0} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<View style={styles.empty}><Text style={{ color: '#666', fontSize: 16 }}>暂无歌曲</Text></View>}
        />
      </SafeAreaView>
      <PlayerBar />
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
