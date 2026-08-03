import { useEffect, useState } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { musicApi, type Song, type Album, type SourceKey } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import SongRow from '../../components/SongRow';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import SourceSwapModal from '../../components/SourceSwapModal';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { probeSongsWithTags } from '../../services/songProbe';
import { swapSongsToSource, countSwapped } from '../../services/sourceSwap';

export default function AlbumDetailPage() {
  const { id, name, pic, artist } = useLocalSearchParams<{ id: string; name?: string; pic?: string; artist?: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  // 换源状态
  const [swapVisible, setSwapVisible] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapResult, setSwapResult] = useState<{ swapped: number; total: number } | null>(null);

  const displayName = album?.name || name || '专辑';
  const displayPic = album?.picUrl || pic || '';
  const displayArtist = album?.artist || artist || '';

  useEffect(() => {
    if (!id) return;
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
            if (!cancelled) setSongs([...r.songs]);
          });
          // 音频质量探测:30 秒片段(网易云 VIP 限制)自动标「片段」徽标
          void probeSongsWithTags(r.songs);
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

  // 换源:逐首搜索目标源完整版 → 替换队列从第一首播放
  const handleSwapSource = async (source: SourceKey) => {
    setSwapLoading(true);
    setSwapResult(null);
    try {
      const swapped = await swapSongsToSource(songs, source);
      const swappedCount = countSwapped(songs, swapped);
      setSwapResult({ swapped: swappedCount, total: songs.length });
      setSongs(swapped);
      usePlayerStore.getState().setQueue(swapped, 0);
      playSong(swapped[0]);
    } catch (e: any) {
      console.error('[AlbumDetail] swap error:', e.message);
    } finally {
      setSwapLoading(false);
    }
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
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.playAllBtn} activeOpacity={0.8} onPress={handlePlayAll}>
                  <Ionicons name="play" size={16} color="#fff" />
                  <Text style={styles.playAllText}>播放全部</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.swapBtn}
                  activeOpacity={0.8}
                  onPress={() => { setSwapVisible(true); setSwapResult(null); }}
                >
                  <Ionicons name="swap-horizontal" size={16} color="#e74c3c" />
                  <Text style={styles.swapText}>换源完整版</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          renderItem={({ item }) => <SongRow song={item} showSource queueSongs={songs} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<View style={styles.empty}><Text style={{ color: '#666', fontSize: 16 }}>暂无歌曲</Text></View>}
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
      <SourceSwapModal
        visible={swapVisible}
        loading={swapLoading}
        swappedCount={swapResult?.swapped}
        totalCount={swapResult?.total}
        onSelect={handleSwapSource}
        onClose={() => setSwapVisible(false)}
      />
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
  swapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2a2a4a', borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 8, marginTop: 16,
  },
  swapText: { color: '#e74c3c', fontSize: 14, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 12 },
  playAllText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  list: { paddingBottom: 100 },
  empty: { paddingVertical: 60, alignItems: 'center' },
});
