import { useEffect, useState } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { musicApi, type Song } from '@mplayer/core';
import type { DiscoverPlaylist } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import SongRow from '../../components/SongRow';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';

export default function DiscoverPlaylistDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<DiscoverPlaylist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const p = await musicApi.getNeteasePlaylistDetail(Number(id));
      if (cancelled) return;
      setPlaylist(p);
      if (p) {
        const url = `https://music.163.com/playlist?id=${id}`;
        const s = await musicApi.getPlaylistSongsFromThirdParty(url, 'netease');
        if (!cancelled) setSongs(s);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

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
