import { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  Modal, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type Song, SourceKey } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useFavoriteStore } from '../stores/favoriteStore';
import AddToPlaylistModal from './AddToPlaylistModal';
import { playSong } from '../services/audioPlayer';

interface SongRowProps {
  song: Song;
  rank?: number;
  onPress?: (song: Song) => void;
  showSource?: boolean;
  defaultFavorited?: boolean;
  queueSongs?: Song[];
}

const SOURCE_COLORS: Record<SourceKey, string> = {
  netease: '#e74c3c',
  qq: '#3498db',
  kugou: '#9b59b6',
  migu: '#e67e22',
  kuwo: '#1abc9c',
  qianqian: '#95a5a6',
  soda: '#2ecc71',
  local: '#7f8c8d',
};

const SOURCE_LABELS: Record<SourceKey, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  migu: '咪咕',
  kuwo: '酷我',
  qianqian: '千千',
  soda: '汽水',
  local: '本地',
};

export default function SongRow({
  song,
  rank,
  onPress,
  showSource = false,
  defaultFavorited = false,
  queueSongs,
}: SongRowProps) {
  const isFav = useFavoriteStore((s) => s.isFavorite(song.id));
  const addFavorite = useFavoriteStore((s) => s.addFavorite);
  const removeFavorite = useFavoriteStore((s) => s.removeFavorite);

  const favorited = defaultFavorited || isFav;
  const [showActions, setShowActions] = useState(false);
  const [pressingAction, setPressingAction] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);

  const handleMore = () => {
    setShowActions(true);
    setPressingAction(true);
    setTimeout(() => setPressingAction(false), 100);
  };

  const handleDownload = () => {
    setShowActions(false);
    Alert.alert('提示', '下载功能即将推出');
  };

  const handleSearchArtist = () => {
    setShowActions(false);
    router.push(`/search?q=${encodeURIComponent(song.artist)}`);
  };

  const MORE_ACTIONS = [
    { key: 'playlist', icon: 'list-outline', label: '加入歌单', onPress: () => { setShowActions(false); setShowPlaylistModal(true); } },
    { key: 'download', icon: 'download-outline', label: '下载', onPress: handleDownload },
    { key: 'artist', icon: 'person-outline', label: '搜索歌手', onPress: handleSearchArtist },
  ];

  const handlePress = () => {
    if (pressingAction) return;
    console.log(`[SongRow] handlePress: id=${song.id}, name=${song.name}`);
    if (onPress) {
      onPress(song);
    } else if (queueSongs) {
      const idx = queueSongs.findIndex(s => s.id === song.id);
      usePlayerStore.getState().setQueue(queueSongs, Math.max(0, idx));
      playSong(song);
    } else {
      usePlayerStore.getState().setQueue([song], 0);
      playSong(song);
    }
  };

  const handleFavorite = () => {
    setPressingAction(true);
    setTimeout(() => setPressingAction(false), 100);
    if (favorited) {
      removeFavorite(song.id);
    } else {
      addFavorite(song);
    }
  };

  const sourceKey = song.sourceType as SourceKey;

  return (
    <>
      <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.6}
    >
      {rank !== undefined && (
        <Text style={styles.rank}>{rank}</Text>
      )}

      <Image
        source={{ uri: song.cover }}
        style={styles.cover}
      />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {song.name}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist}
        </Text>
      </View>

      {showSource && (
        <View style={[styles.sourceBadge, { backgroundColor: SOURCE_COLORS[sourceKey] || '#666' }]}>
          <Text style={styles.sourceText}>
            {SOURCE_LABELS[sourceKey] || sourceKey}
          </Text>
        </View>
      )}

      <TouchableOpacity
        onPress={handleFavorite}
        style={styles.favoriteBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={favorited ? 'heart' : 'heart-outline'}
          size={20}
          color={favorited ? '#e74c3c' : '#666'}
        />
      </TouchableOpacity>
      <TouchableOpacity onPress={handleMore} style={styles.moreBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="ellipsis-vertical" size={18} color="#666" />
      </TouchableOpacity>
    </TouchableOpacity>

    <Modal visible={showActions} animationType="slide" transparent onRequestClose={() => setShowActions(false)}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowActions(false)}>
        <View style={styles.actionSheet}>
          <Text style={styles.actionSheetTitle} numberOfLines={1}>{song.name}</Text>
          {MORE_ACTIONS.map(a => (
            <TouchableOpacity key={a.key} style={styles.actionItem} onPress={a.onPress}>
              <Ionicons name={a.icon as any} size={22} color="#fff" />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.actionCancel} onPress={() => setShowActions(false)}>
            <Text style={styles.cancelText}>取消</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
    <AddToPlaylistModal
      visible={showPlaylistModal}
      song={song}
      onClose={() => setShowPlaylistModal(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1a1a2e',
  },
  rank: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    width: 28,
    textAlign: 'center',
    marginRight: 4,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
    marginRight: 12,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  artist: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  sourceBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  sourceText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  favoriteBtn: {
    padding: 4,
  },
  moreBtn: {
    padding: 4,
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
  },
  actionSheetTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
  actionCancel: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
  },
  cancelText: {
    color: '#888',
    fontSize: 16,
  },
});
