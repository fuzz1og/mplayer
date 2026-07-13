import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { usePlaylistStore } from '../../stores/playlistStore';
import SongRow from '../../components/SongRow';
import type { Song } from '@mplayer/core';

export default function PlaylistDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlists = usePlaylistStore((s) => s.playlists);
  const removeSong = usePlaylistStore((s) => s.removeSong);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);

  const playlist = playlists.find((p) => p.id === id);

  const handleRemoveSong = useCallback(
    (song: Song) => {
      Alert.alert('移除歌曲', `确定要从歌单移除「${song.name}」吗？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '移除',
          style: 'destructive',
          onPress: () => removeSong(playlist!.id, song.id),
        },
      ]);
    },
    [playlist, removeSong],
  );

  const handleRename = useCallback(() => {
    if (!playlist) return;
    Alert.prompt(
      '重命名歌单',
      '请输入新的名称',
      (name) => {
        const trimmed = name.trim();
        if (trimmed) renamePlaylist(playlist.id, trimmed);
      },
      'plain-text',
      playlist.name,
    );
  }, [playlist, renamePlaylist]);

  if (!playlist) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: '歌单' }} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={48} color="#555" />
          <Text style={styles.emptyText}>歌单不存在</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: playlist.name,
          headerRight: () => (
            <TouchableOpacity onPress={handleRename} style={{ marginRight: 4 }}>
              <Ionicons name="pencil-outline" size={20} color="#ccc" />
            </TouchableOpacity>
          ),
        }}
      />

      {playlist.songs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="musical-notes-outline" size={64} color="#444" />
          <Text style={styles.emptyText}>歌单是空的</Text>
        </View>
      ) : (
        <FlatList
          data={playlist.songs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={1}
              onLongPress={() => handleRemoveSong(item)}
            >
              <SongRow song={item} showSource />
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  list: { paddingBottom: 100 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyText: { color: '#888', fontSize: 16, marginTop: 12 },
});
