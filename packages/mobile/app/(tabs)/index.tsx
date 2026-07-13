import { useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, Image, StyleSheet, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { useDiscoverStore, HotlistItem } from '../../stores/discoverStore';
import { usePlayerStore } from '../../stores/playerStore';

const SECTIONS = [
  { key: 'neteaseHotlist' as const, title: '网易云音乐 · 热歌榜' },
  { key: 'qqHotlist' as const, title: 'QQ 音乐 · 热歌榜' },
  { key: 'neteaseNew' as const, title: '网易云音乐 · 新歌榜' },
  { key: 'qqNew' as const, title: 'QQ 音乐 · 新歌榜' },
];

export default function DiscoverPage() {
  const loading = useDiscoverStore(s => s.loading);
  const load = useDiscoverStore(s => s.load);
  const getSongs = useCallback((key: string) => {
    const state = useDiscoverStore.getState();
    return (state as any)[key] as HotlistItem[];
  }, []);

  useEffect(() => { load(); }, []);

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator color="#e74c3c" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={SECTIONS}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <SectionCard
              title={item.title}
              songs={getSongs(item.key)}
              routeKey={item.key}
            />
          )}
        />
      )}
    </View>
  );
}

function SectionCard({ title, songs, routeKey }: { title: string; songs: HotlistItem[]; routeKey: string }) {
  const playSong = useCallback((song: HotlistItem) => {
    const s = {
      id: song.id,
      name: song.name,
      artist: song.artists,
      album: song.album,
      cover: song.cover,
      url: '',
      lrc: '',
      duration: 0,
      sourceType: 'netease' as const,
    };
    usePlayerStore.getState().setQueue([s], 0);
  }, []);

  return (
    <View style={styles.section}>
      <TouchableOpacity onPress={() => router.push(`/hotlist?key=${routeKey}&title=${encodeURIComponent(title)}`)}>
        <Text style={styles.sectionTitle}>{title} ›</Text>
      </TouchableOpacity>
      {songs.slice(0, 5).map((song, i) => (
        <TouchableOpacity key={song.id + String(i)} style={styles.songRow} onPress={() => playSong(song)}>
          <Text style={styles.rank}>{i + 1}</Text>
          <Image source={{ uri: song.cover }} style={styles.cover} />
          <View style={styles.songInfo}>
            <Text style={styles.songName} numberOfLines={1}>{song.name}</Text>
            <Text style={styles.songArtist} numberOfLines={1}>{song.artists}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  section: {
    backgroundColor: '#16213e',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rank: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    width: 28,
    textAlign: 'center',
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
    marginRight: 10,
  },
  songInfo: { flex: 1 },
  songName: { color: '#fff', fontSize: 14 },
  songArtist: { color: '#888', fontSize: 12, marginTop: 2 },
});
