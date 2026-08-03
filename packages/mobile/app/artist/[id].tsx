import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { musicApi, type Song, type Album } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import SongRow from '../../components/SongRow';
import { probeSongsWithTags } from '../../services/songProbe';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';

export default function ArtistDetailPage() {
  const { id, name, pic } = useLocalSearchParams<{ id: string; name?: string; pic?: string }>();
  const [artist, setArtist] = useState<any>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
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
      try {
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
        // 优先用入口传入的 weapi 高清头像（searchNeteaseArtists 结果兜底）
        setArtist({ ...info, name: info?.name || artistName, picUrl: pic || info?.picUrl || '' });
        // 补齐缺失 URL 后探测:30 秒片段自动标「短时长」徽标
        void musicApi.resolveNeteaseSongUrls(songResult.songs, false).then(() => {
          if (!cancelled) probeSongsWithTags(songResult.songs);
        });
      } catch (e: any) {
        console.error('[ArtistDetail] load error:', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, name]);

  // 专辑区块:前 20 张,横向滚动
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    musicApi.getArtistAlbums(id as string, 0, 20)
      .then(r => { if (!cancelled) setAlbums(r.albums); })
      .catch((e: any) => console.error('[ArtistDetail] albums error:', e.message));
    return () => { cancelled = true; };
  }, [id]);

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
              {songTotalRef.current > 0 && <Text style={styles.subtitle}>共 {songTotalRef.current} 首歌曲</Text>}
              {albums.length > 0 && (
                <View style={styles.albumsSection}>
                  <Text style={styles.albumsTitle}>专辑</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {albums.map(a => (
                      <TouchableOpacity
                        key={a.id}
                        style={styles.albumCard}
                        activeOpacity={0.7}
                        onPress={() => router.push(`/album/${a.id}?name=${encodeURIComponent(a.name)}&pic=${encodeURIComponent(a.picUrl)}&artist=${encodeURIComponent(a.artist)}` as any)}
                      >
                        {a.picUrl ? (
                          <Image source={{ uri: a.picUrl }} style={styles.albumCover} />
                        ) : (
                          <View style={[styles.albumCover, { backgroundColor: '#2a2a4a', justifyContent: 'center', alignItems: 'center' }]}>
                            <Ionicons name="disc" size={24} color="#555" />
                          </View>
                        )}
                        <Text style={styles.albumName} numberOfLines={1}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
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
      <BottomSafePlayerBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  avatar: { width: 120, height: 120, borderRadius: 60, marginBottom: 16 },
  name: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#888', fontSize: 13, marginTop: 6 },
  albumsSection: { alignSelf: 'stretch', marginTop: 20 },
  albumsTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 12 },
  albumCard: { width: 100, marginRight: 12 },
  albumCover: { width: 100, height: 100, borderRadius: 10, backgroundColor: '#2a2a4a' },
  albumName: { color: '#aaa', fontSize: 12, marginTop: 6 },
  list: { paddingBottom: 100 },
  empty: { paddingVertical: 60, alignItems: 'center' },
});
