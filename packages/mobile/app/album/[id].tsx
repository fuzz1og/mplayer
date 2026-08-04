import { useEffect, useState } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { musicApi, type Song, type Album } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import SongRow from '../../components/SongRow';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { probeSongsWithTags } from '../../services/songProbe';

export default function AlbumDetailPage() {
  const { id, name, pic, artist } = useLocalSearchParams<{ id: string; name?: string; pic?: string; artist?: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  const displayName = album?.name || name || '专辑';
  const displayPic = album?.picUrl || pic || '';
  const displayArtist = album?.artist || artist || '';

  useEffect(() => {
    // 缺 id（畸形链接）不能卡在 LoadingState：直接结束加载态渲染空列表
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await musicApi.getAlbumDetail(id, true);
        if (cancelled) return;
        if (r) {
          setAlbum(r.album);
          setSongs(r.songs);
          // 后台补齐缺失 URL(weapi 批量 + 10 并发搜索兜底),完成后触发重渲染
          void musicApi.resolveNeteaseSongUrls(r.songs, false).then(() => {
            if (cancelled) return;
            setSongs([...r.songs]);
            // URL 补齐后再探测：无版权歌 url 仍为空（搜索兜底已严格校验不填翻唱）
            // → 标「无效」徽标，用户看到就会去单曲换源
            void probeSongsWithTags(r.songs, { missingAsInvalid: true });
          });
        }
      } catch (e: any) {
        console.error('[AlbumDetail] load error:', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    playSong(songs[0]);
  };

  // 单曲换源后更新列表（SongRow 更多菜单触发）
  const handleSwap = (original: Song, swapped: Song) => {
    setSongs((prev) => prev.map((s) => (s.id === original.id ? swapped : s)));
  };

  const year = (() => {
    const t = Number(album?.publishTime || 0);
    return t > 0 ? String(new Date(t).getFullYear()) : '';
  })();

  if (loading) return <LoadingState />;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <StatusBar style="light" />
        <Stack.Screen options={{ title: displayName, headerShown: true, headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
        <FlatList
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          ListHeaderComponent={() => (
            <View style={styles.header}>
              {displayPic ? (
                <Image source={{ uri: displayPic }} style={styles.cover} />
              ) : (
                <View style={[styles.cover, { backgroundColor: '#2a2a4a', justifyContent: 'center', alignItems: 'center' }]}>
                  <Ionicons name="disc" size={56} color="#555" />
                </View>
              )}
              <Text style={styles.name}>{displayName}</Text>
              {displayArtist ? <Text style={styles.artist}>{displayArtist}</Text> : null}
              <View style={styles.metaRow}>
                {year ? <Text style={styles.meta}>{year}</Text> : null}
                <Text style={styles.meta}>{songs.length} 首</Text>
              </View>
              <TouchableOpacity style={styles.playAllBtn} activeOpacity={0.8} onPress={handlePlayAll}>
                <Ionicons name="play" size={16} color="#fff" />
                <Text style={styles.playAllText}>播放全部</Text>
              </TouchableOpacity>
            </View>
          )}
          renderItem={({ item }) => (
            <SongRow song={item} showSource queueSongs={songs} onSwap={handleSwap} />
          )}
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
  cover: { width: 200, height: 200, borderRadius: 16, marginBottom: 16 },
  name: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  artist: { color: '#888', fontSize: 13, marginTop: 6 },
  metaRow: { flexDirection: 'row', gap: 20, marginTop: 10 },
  meta: { color: '#666', fontSize: 12 },
  playAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#e74c3c', borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 8, marginTop: 16,
  },
  playAllText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  list: { paddingBottom: 100 },
  empty: { paddingVertical: 60, alignItems: 'center' },
});
