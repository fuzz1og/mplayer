import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  Modal, FlatList,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay, playSong, fetchLrcInBackground } from '../services/audioPlayer';

export default function PlayerBar() {
  const insets = useSafeAreaInsets();
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const queue = usePlayerStore(s => s.queue);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);
  const setQueue = usePlayerStore(s => s.setQueue);
  const setShowPlayer = usePlayerStore(s => s.setShowPlayer);
  const [showQueue, setShowQueue] = useState(false);
  // 封面加载失败 → 占位图标 + 懒刷新兜底（搜索补新封面，写回后自动恢复）
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => { setCoverFailed(false); }, [currentSong?.cover]);
  const handleCoverError = () => {
    setCoverFailed(true);
    if (currentSong) void fetchLrcInBackground(currentSong, true);
  };

  return (
    <TouchableOpacity
      style={[styles.container, !currentSong && styles.containerEmpty]}
      onPress={() => currentSong && setShowPlayer(true)}
      activeOpacity={0.8}
      disabled={!currentSong}
    >
      {/* 专辑封面 */}
      <View style={styles.coverWrap}>
        {currentSong?.cover && !coverFailed ? (
          <Image source={{ uri: currentSong.cover }} style={styles.cover} onError={handleCoverError} />
        ) : (
          <Ionicons name="musical-note" size={24} color="#555" />
        )}
      </View>

      {/* 歌曲信息 */}
      <View style={styles.info}>
        <Text style={[styles.title, !currentSong && styles.textEmpty]} numberOfLines={1}>
          {currentSong ? currentSong.name : '未在播放'}
        </Text>
        <Text style={[styles.artist, !currentSong && styles.textEmpty]} numberOfLines={1}>
          {currentSong ? currentSong.artist : '选择一个歌曲开始播放'}
        </Text>
      </View>

      {/* 控制按钮 */}
      {currentSong && (
        <View style={styles.controls}>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); prev(); const s = usePlayerStore.getState().currentSong; if (s) playSong(s); }}
            style={styles.btn}
          >
            <Ionicons name="play-skip-back" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); togglePlay(); }}
            style={styles.btn}
          >
            <Ionicons
              name={isPlaying ? 'pause-circle' : 'play-circle'}
              size={36}
              color="#e74c3c"
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); next(); const s = usePlayerStore.getState().currentSong; if (s) playSong(s); }}
            style={styles.btn}
          >
            <Ionicons name="play-skip-forward" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              setShowQueue(true);
            }}
            style={styles.btn}
          >
            <Ionicons name="list-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
      {/* 队列弹窗 */}
      <Modal
        visible={showQueue}
        animationType="slide"
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setShowQueue(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(40, insets.bottom + 24) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>播放队列 ({queue.length})</Text>
              <TouchableOpacity onPress={() => setShowQueue(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={queue}
              keyExtractor={(item, i) => `${item.id}-${i}`}
              renderItem={({ item, index }) => {
                const isCurrent = currentSong?.id === item.id;
                return (
                  <TouchableOpacity
                    style={styles.queueItem}
                    onPress={() => {
                      setQueue(queue, index);
                      playSong(item);
                      setShowQueue(false);
                    }}
                  >
                    <View style={styles.queueItemInfo}>
                      <Text style={[styles.queueItemName, isCurrent && styles.queueItemActive]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.queueItemArtist}>{item.artist}</Text>
                    </View>
                    {isCurrent && <Ionicons name="play" size={16} color="#e74c3c" />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>队列为空</Text>}
            />
          </View>
        </View>
      </Modal>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  containerEmpty: {
    opacity: 0.6,
  },
  coverWrap: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#2a2a4a',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  info: { flex: 1, marginRight: 12 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  artist: { color: '#888', fontSize: 12, marginTop: 2 },
  textEmpty: { color: '#555' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btn: { padding: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  queueItemInfo: { flex: 1, marginRight: 12 },
  queueItemName: { color: '#fff', fontSize: 15 },
  queueItemActive: { color: '#e74c3c' },
  queueItemArtist: { color: '#888', fontSize: 12, marginTop: 2 },
  emptyText: { color: '#666', textAlign: 'center', marginTop: 40 },
});
