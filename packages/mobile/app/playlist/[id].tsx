import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleAlert, Pencil, Music2 } from 'lucide-react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { usePlaylistStore } from '../../stores/playlistStore';
import SongRow from '../../components/SongRow';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import type { Song } from '@mplayer/core';

export default function PlaylistDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlists = usePlaylistStore((s) => s.playlists);
  const removeSong = usePlaylistStore((s) => s.removeSong);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const replaceSong = usePlaylistStore((s) => s.replaceSong);

  const playlist = playlists.find((p) => p.id === id);

  // 单曲换源：原位替换并持久化到歌单存储
  const handleSwap = useCallback(
    (original: Song, swapped: Song) => {
      if (playlist) replaceSong(playlist.id, original.id, swapped);
    },
    [playlist, replaceSong],
  );

  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');

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
    setRenameValue(playlist.name);
    setRenameModalVisible(true);
  }, [playlist]);

  const handleRenameConfirm = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !playlist) return;
    renamePlaylist(playlist.id, trimmed);
    setRenameModalVisible(false);
  };

  if (!playlist) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <Stack.Screen options={{ title: '歌单', headerShown: true }} />
          <View style={styles.empty}>
            <CircleAlert size={48} color="#555" />
            <Text style={styles.emptyText}>歌单不存在</Text>
          </View>
        </SafeAreaView>
        <BottomSafePlayerBar />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <StatusBar style="light" />
        <Stack.Screen
          options={{
            title: playlist.name,
            headerShown: true,
            headerStyle: { backgroundColor: '#1a1a2e' },
            headerTintColor: '#fff',
            headerShadowVisible: false,
            headerRight: () => (
              <TouchableOpacity onPress={handleRename} style={{ marginRight: 4 }}>
                <Pencil size={20} color="#ccc" />
              </TouchableOpacity>
            ),
          }}
        />

        {playlist.songs.length === 0 ? (
          <View style={styles.empty}>
            <Music2 size={64} color="#444" />
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
                <SongRow song={item} showSource queueSongs={playlist.songs} onSwap={handleSwap} />
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.list}
          />
        )}

        <Modal
          visible={renameModalVisible}
          transparent
          animationType="fade"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setRenameModalVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setRenameModalVisible(false)}
          >
            <TouchableOpacity
              style={styles.modalContent}
              activeOpacity={1}
              onPress={() => {}}
            >
              <Text style={styles.modalTitle}>重命名歌单</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="输入歌单名称"
                placeholderTextColor="#666"
                value={renameValue}
                onChangeText={setRenameValue}
                autoFocus
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setRenameValue('');
                    setRenameModalVisible(false);
                  }}
                >
                  <Text style={styles.cancelText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.confirmBtn,
                    !renameValue.trim() && { opacity: 0.4 },
                  ]}
                  onPress={handleRenameConfirm}
                  disabled={!renameValue.trim()}
                >
                  <Text style={styles.confirmText}>确认</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
      <BottomSafePlayerBar />
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

  // modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 24,
    width: '80%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#2a2a4a',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
  },
  cancelText: { color: '#888', fontSize: 15 },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e74c3c',
    alignItems: 'center',
  },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
