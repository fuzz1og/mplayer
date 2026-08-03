import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { musicApi, formatPlayCount, type Song } from '@mplayer/core';
import type { DiscoverPlaylist } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import SongRow from '../../components/SongRow';
import { probeSongsWithTags } from '../../services/songProbe';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';

const PAGE_SIZE = 50;

export default function DiscoverPlaylistDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<DiscoverPlaylist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    offsetRef.current = 0;
    (async () => {
      try {
        // 元数据与第一页歌曲并行（weapi 直连，歌曲含已解析播放 URL）
        // 跳过逐首搜索兜底(慢):先秒显列表,后台批量补齐 URL 后更新
        const [p, page] = await Promise.all([
          musicApi.getNeteasePlaylistDetail(Number(id)),
          musicApi.getNeteasePlaylistSongsPage(Number(id), 0, PAGE_SIZE, true),
        ]);
        if (cancelled) return;
        setPlaylist(p);
        setSongs(page.songs);
        setHasMore(page.songs.length < page.total);
        offsetRef.current = PAGE_SIZE;
        // 后台补齐缺失 URL(weapi 批量 + 10 并发搜索兜底),完成后触发重渲染
        void musicApi.resolveNeteaseSongUrls(page.songs, false).then(() => {
          if (!cancelled) setSongs([...page.songs]);
        });
        // 音频质量探测:30 秒片段自动标「短时长」徽标
        void probeSongsWithTags(page.songs);
      } catch (e: any) {
        console.error('[DiscoverPlaylistDetail] load error:', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !id) return;
    setLoadingMore(true);
    try {
      const page = await musicApi.getNeteasePlaylistSongsPage(Number(id), offsetRef.current, PAGE_SIZE, true);
      if (page.songs.length > 0) {
        setSongs(prev => [...prev, ...page.songs]);
        offsetRef.current += PAGE_SIZE;
        setHasMore(offsetRef.current < page.total);
        // 后台补齐本页缺失 URL
        void musicApi.resolveNeteaseSongUrls(page.songs, false).then(() => {
          setSongs(prev => [...prev]);
        });
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[DiscoverPlaylistDetail] loadMore error:', e.message);
    } finally {
      setLoadingMore(false);
    }
  };

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
          ListHeaderComponent={() => (
            <View style={styles.header}>
              <Image source={{ uri: playlist.coverImgUrl }} style={styles.cover} />
              <Text style={styles.name}>{playlist.name}</Text>
              <Text style={styles.creator}>{playlist.creator?.nickname ?? '未知'}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>播放: {formatPlayCount(playlist.playCount)}</Text>
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
          renderItem={({ item }) => (
            <SongRow
              song={item}
              showSource
              queueSongs={songs}
              onSwap={(original, swapped) =>
                setSongs((prev) => prev.map((s) => (s.id === original.id ? swapped : s)))
              }
            />
          )}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={songs.length > 0} />}
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
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
  list: { paddingBottom: 100 },
});
