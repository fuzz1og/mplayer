import { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { musicApi, type Song } from '@mplayer/core';
import type { DiscoverPlaylist } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import SongRow from '../../components/SongRow';
import PlayerBar from '../../components/PlayerBar';

export default function DiscoverPlaylistDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<DiscoverPlaylist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const p = await musicApi.getNeteasePlaylistDetail(Number(id));
      if (cancelled) return;
      setPlaylist(p);
      if (p) {
        // 分页加载第一页,下滑加载更多;第一页失败回退第三方解析
        const page = await musicApi.getNeteasePlaylistSongsPage(Number(id), 0, PAGE_SIZE);
        if (!page.songs || page.songs.length === 0) {
          const url = `https://music.163.com/playlist?id=${id}`;
          const s = await musicApi.getPlaylistSongsFromThirdParty(url, 'netease');
          if (!cancelled) {
            setSongs(s);
            setTotal(s.length);
          }
        } else if (!cancelled) {
          setSongs(page.songs);
          setTotal(page.total);
          setHasMore(page.songs.length < page.total);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  // 下滑加载更多
  const loadMore = useCallback(async () => {
    if (!id || loadingMoreRef.current || !hasMore || loading) return;
    loadingMoreRef.current = true;
    try {
      setLoadingMore(true);
      const page = await musicApi.getNeteasePlaylistSongsPage(Number(id), songs.length, PAGE_SIZE);
      if (page.songs.length > 0) {
        setSongs(prev => [...prev, ...page.songs]);
        setTotal(page.total);
        setHasMore(songs.length + page.songs.length < page.total);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error('加载更多歌曲失败:', e);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [id, songs.length, hasMore, loading]);

  if (loading) return <LoadingState />;
  if (!playlist) {
    return (
      <View style={styles.empty}>
        <Stack.Screen options={{ title: '歌单详情', headerShown: true }} />
        <Text style={{ color: '#666', fontSize: 16 }}>歌单不存在</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <StatusBar style="light" />
        <Stack.Screen options={{ title: playlist.name, headerShown: true, headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
        <FlatList
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={() => (
            loadingMore ? <ActivityIndicator color="#888" style={{ padding: 16 }} />
              : hasMore ? <Text style={styles.footer}>上滑加载更多</Text>
              : songs.length > 0 ? <Text style={styles.footer}>已加载全部 {songs.length}{total > songs.length ? ` / ${total}` : ''} 首</Text>
              : null
          )}
          ListHeaderComponent={() => (
            <View style={styles.header}>
              <Image source={{ uri: playlist.coverImgUrl }} style={styles.cover} />
              <Text style={styles.name}>{playlist.name}</Text>
              <Text style={styles.creator}>{playlist.creator?.nickname ?? '未知'}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>播放: {(playlist.playCount / 10000).toFixed(0)}万</Text>
                <Text style={styles.meta}>歌曲: {playlist.trackCount}首</Text>
              </View>
              {playlist.tags.length > 0 && (
                <View style={styles.tagsRow}>
                  {playlist.tags.map(t => (
                    <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
                  ))}
                </View>
              )}
            </View>
          )}
          renderItem={({ item }) => <SongRow song={item} showSource queueSongs={songs} />}
          contentContainerStyle={styles.list}
        />
      </SafeAreaView>
      <PlayerBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  empty: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  cover: { width: 200, height: 200, borderRadius: 16, marginBottom: 16 },
  name: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  creator: { color: '#888', fontSize: 13, marginTop: 6 },
  metaRow: { flexDirection: 'row', gap: 20, marginTop: 10 },
  meta: { color: '#666', fontSize: 12 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  tag: { backgroundColor: '#2a2a4a', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: '#e74c3c', fontSize: 12 },
  footer: { textAlign: 'center', color: '#666', fontSize: 12, padding: 16 },
  list: { paddingBottom: 100 },
});
