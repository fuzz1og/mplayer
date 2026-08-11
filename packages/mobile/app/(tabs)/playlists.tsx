import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { usePlaylistStore } from '../../stores/playlistStore';
import type { Playlist } from '../../stores/playlistStore';

const BUILT_IN = [
  { key: 'favorites', icon: 'heart' as const, label: '收藏', desc: '我喜欢的歌曲' },
  { key: 'history', icon: 'time-outline' as const, label: '播放历史', desc: '最近播放的歌曲' },
];

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PlaylistsPage() {
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);

  const [modalVisible, setModalVisible] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createPlaylist(trimmed);
    setNewName('');
    setModalVisible(false);
  };

  const handleDelete = (item: Playlist) => {
    Alert.alert('删除歌单', `确定要删除「${item.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deletePlaylist(item.id) },
    ]);
  };

  const renderItem = ({ item }: { item: Playlist }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() => router.push(`/playlist/${item.id}`)}
      onLongPress={() => handleDelete(item)}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="list-outline" size={24} color="#e74c3c" />
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.rowMeta}>
          {item.songs.length} 首 · {formatDate(item.createdAt)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#555" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>我的歌单</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setModalVisible(true)}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={() => (
          <>
            {BUILT_IN.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.row}
                activeOpacity={0.6}
                onPress={() => router.push(item.key === 'favorites' ? '/favorites' : '/history')}
              >
                <View style={[styles.iconWrap, { backgroundColor: '#2a2a4a' }]}>
                  <Ionicons name={item.icon} size={24} color="#e74c3c" />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>{item.label}</Text>
                  <Text style={styles.rowMeta}>{item.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#555" />
              </TouchableOpacity>
            ))}
            {playlists.length > 0 && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={{ color: '#888', fontSize: 13 }}>我的歌单</Text>
              </View>
            )}
          </>
        )}
      />

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalContent}
            activeOpacity={1}
            onPress={() => {}}
          >
            <Text style={styles.modalTitle}>新建歌单</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="输入歌单名称"
              placeholderTextColor="#666"
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setNewName('');
                  setModalVisible(false);
                }}
              >
                <Text style={styles.cancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  !newName.trim() && { opacity: 0.4 },
                ]}
                onPress={handleCreate}
                disabled={!newName.trim()}
              >
                <Text style={styles.confirmText}>创建</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
    backgroundColor: '#1a1a2e',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e74c3c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingBottom: 100 },

  // rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowInfo: { flex: 1 },
  rowName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  rowMeta: { color: '#888', fontSize: 12, marginTop: 3 },

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
