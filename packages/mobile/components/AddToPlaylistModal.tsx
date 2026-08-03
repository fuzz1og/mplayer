import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Song } from '@mplayer/core';
import { usePlaylistStore } from '../stores/playlistStore';

const SOURCE_LABELS: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ音乐',
  kugou: '酷狗',
  kuwo: '酷我',
  qianqian: '千千',
  soda: '汽水',
  local: '本地',
};

function sourceLabel(sourceType?: string): string {
  return SOURCE_LABELS[sourceType || ''] || sourceType || '未知';
}

interface Props {
  visible: boolean;
  song: Song | null;
  onClose: () => void;
}

export default function AddToPlaylistModal({ visible, song, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const playlists = usePlaylistStore(s => s.playlists);
  const addSong = usePlaylistStore(s => s.addSong);
  const removeSong = usePlaylistStore(s => s.removeSong);
  const [addedName, setAddedName] = useState<string | null>(null);

  const handleSelect = (playlistId: string, playlistName: string) => {
    if (!song) return;
    const playlist = playlists.find((p) => p.id === playlistId);
    // 同一首歌（同 id）已在歌单中 → 直接提示不加
    if (playlist?.songs.some((s) => s.id === song.id)) {
      Alert.alert('提示', '这首歌已在歌单中');
      return;
    }
    // 跨源同名同歌手 → 弹窗让用户选保留哪首
    const dup = playlist?.songs.find(
      (s) => s.name === song.name && s.artist === song.artist && s.sourceType !== song.sourceType
    );
    if (dup) {
      Alert.alert(
        '发现同名歌曲',
        `歌单中已有「${song.name}」的${sourceLabel(dup.sourceType)}版本，要替换成这首${sourceLabel(song.sourceType)}版本吗？`,
        [
          { text: '取消', style: 'cancel' },
          { text: '保留原版', onPress: () => { setAddedName(playlistName); showSuccess(playlistName); } },
          {
            text: '替换为新版',
            onPress: () => {
              removeSong(playlistId, dup.id);
              addSong(playlistId, song);
              setAddedName(playlistName);
              showSuccess(playlistName);
            },
          },
        ]
      );
      return;
    }
    addSong(playlistId, song);
    setAddedName(playlistName);
    showSuccess(playlistName);
  };

  const showSuccess = (playlistName: string) => {
    setTimeout(() => {
      setAddedName(null);
      onClose();
    }, 1200);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        {addedName ? (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={48} color="#e74c3c" />
            <Text style={styles.successText}>已加入歌单「{addedName}」</Text>
          </View>
        ) : (
          <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]} activeOpacity={1} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>加入歌单</Text>
            {song && (
              <Text style={styles.songName} numberOfLines={1}>{song.name}</Text>
            )}
            {playlists.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="list-outline" size={40} color="#444" />
                <Text style={styles.emptyText}>暂无歌单</Text>
                <Text style={styles.emptyHint}>请先在歌单页面创建</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {playlists.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.item}
                    onPress={() => handleSelect(p.id, p.name)}
                  >
                    <Ionicons name="list-outline" size={22} color="#e74c3c" />
                    <Text style={styles.itemText}>{p.name}</Text>
                    <Text style={styles.itemCount}>{p.songs.length}首</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    width: '100%',
    maxHeight: '70%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3a3a5e',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  songName: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  list: {
    marginBottom: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  itemText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
    flex: 1,
  },
  itemCount: {
    color: '#666',
    fontSize: 13,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
    marginTop: 12,
  },
  emptyHint: {
    color: '#555',
    fontSize: 13,
    marginTop: 4,
  },
  cancelBtn: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
  },
  cancelText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  successBox: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 100,
  },
  successText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 12,
    fontWeight: '600',
  },
});
