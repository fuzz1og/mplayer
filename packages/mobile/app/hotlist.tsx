import { useCallback, useEffect, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Text,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { musicApi } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';
import LoadingState from '../components/LoadingState';
import SongRow from '../components/SongRow';

interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

const API_MAP: Record<
  string,
  { fetcher: () => Promise<HotlistSong[]>; sourceType: SourceKey }
> = {
  neteaseHotlist: { fetcher: () => musicApi.getNeteaseHotlist(), sourceType: 'netease' },
  qqHotlist: { fetcher: () => musicApi.getQQHotlist(), sourceType: 'qq' },
  neteaseNew: { fetcher: () => musicApi.getNeteaseNewSongList(), sourceType: 'netease' },
  qqNew: { fetcher: () => musicApi.getQQNewSongList(), sourceType: 'qq' },
};

function toSong(item: HotlistSong, sourceType: SourceKey): Song {
  return {
    id: item.id,
    name: item.name,
    artist: item.artists,
    album: item.album,
    cover: item.cover,
    url: '',
    lrc: '',
    duration: 0,
    sourceType,
  };
}

export default function HotlistPage() {
  const { key, title } = useLocalSearchParams<{ key: string; title: string }>();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const config = key ? API_MAP[key] : undefined;

  const fetchSongs = useCallback(async () => {
    if (!config) return;
    try {
      const raw = await config.fetcher();
      setSongs(raw.map((item) => toSong(item, config.sourceType)));
    } catch (err) {
      console.error('加载榜单失败:', err);
    }
  }, [config]);

  useEffect(() => {
    fetchSongs().finally(() => setLoading(false));
  }, [fetchSongs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSongs();
    setRefreshing(false);
  }, [fetchSongs]);

  if (!config) {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: title || '未知榜单',
            headerStyle: { backgroundColor: '#1a1a2e' },
            headerTintColor: '#fff',
            headerShadowVisible: false,
          }}
        />
        <Text style={styles.errorText}>未知榜单类型</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: title || '',
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          headerShadowVisible: false,
        }}
      />
      {loading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={songs}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <SongRow song={item} rank={index + 1} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#e74c3c"
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  errorText: { color: '#888', fontSize: 16, textAlign: 'center', marginTop: 40 },
});
