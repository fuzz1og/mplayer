import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, Dimensions, FlatList,
  Modal, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import Slider from '@react-native-community/slider';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay, seekTo } from '../services/audioPlayer';
import { parseLRC, musicApi, findCurrentLyricIndex } from '@mplayer/core';
import type { LyricLine } from '@mplayer/core';

const { width } = Dimensions.get('window');

export default function PlayerPage() {
  const song = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const queue = usePlayerStore(s => s.queue);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);

  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [currentLineIdx, setCurrentLineIdx] = useState(-1);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lyricsFlatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!song) router.back();
  }, [song]);

  // 加载歌词
  useEffect(() => {
    if (!song?.lrc) { setLyricLines([]); return; }
    musicApi.getLyrics(song.lrc).then(lrc => {
      const parsed = parseLRC(lrc);
      setLyricLines(parsed.lines);
    }).catch(() => setLyricLines([]));
  }, [song?.lrc]);

  // 更新当前高亮歌词行
  useEffect(() => {
    if (lyricLines.length === 0) {
      if (currentLineIdx !== -1) setCurrentLineIdx(-1);
      return;
    }
    const idx = findCurrentLyricIndex(lyricLines, currentTime);
    if (idx !== currentLineIdx) {
      setCurrentLineIdx(idx);
      if (idx >= 0) {
        try { flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }); } catch {}
        try { lyricsFlatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }); } catch {}
      }
    }
  }, [currentTime, lyricLines, currentLineIdx]);

  function moveToTop(index: number) {
    const state = usePlayerStore.getState();
    const q = [...state.queue];
    const [item] = q.splice(index, 1);
    q.unshift(item);
    usePlayerStore.setState({ queue: q });
  }

  function removeFromQueue(index: number) {
    const state = usePlayerStore.getState();
    const q = [...state.queue];
    q.splice(index, 1);
    const currentIdx = state.queue.findIndex(s => s.id === state.currentSong?.id);
    if (currentIdx === index) {
      const nextSong = q[Math.min(index, q.length - 1)] || null;
      usePlayerStore.setState({ queue: q, currentSong: nextSong, currentTime: 0 });
    } else {
      usePlayerStore.setState({ queue: q });
    }
  }

  if (!song) return null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        headerShown: true,
        title: '',
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.replace('/')}>
            <Ionicons name="chevron-down" size={28} color="#fff" />
          </TouchableOpacity>
        ),
        headerRight: () => (
          <TouchableOpacity onPress={() => setShowLyrics(v => !v)}>
            <Text style={{ color: '#e74c3c', fontSize: 16, fontWeight: '600' }}>
              {showLyrics ? '封' : '词'}
            </Text>
          </TouchableOpacity>
        ),
      }} />

      {showLyrics ? (
        /* 全屏歌词视图 */
        <View style={styles.lyricsFullWrap}>
          {lyricLines.length > 0 ? (
            <FlatList
              ref={lyricsFlatListRef}
              data={lyricLines}
              keyExtractor={(_, i) => String(i)}
              style={styles.lyricsFullList}
              contentContainerStyle={styles.lyricsFullContent}
              renderItem={({ item, index }) => (
                <Text style={[
                  styles.lyricLine,
                  index === currentLineIdx && styles.lyricLineActive
                ]}>
                  {item.text}
                </Text>
              )}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <Text style={{ color: '#666', fontSize: 16 }}>暂无歌词</Text>
          )}
        </View>
      ) : (
        <>
          {/* 专辑封面 */}
          <View style={styles.coverWrap}>
            <Image
              source={{ uri: song.cover || 'https://via.placeholder.com/300' }}
              style={styles.cover}
            />
          </View>

          {/* 歌曲信息 */}
          <View style={styles.infoWrap}>
            <Text style={styles.title}>{song.name}</Text>
            <Text style={styles.artist}>{song.artist}</Text>
            <TouchableOpacity onPress={() => setShowQueue(true)} style={styles.queueBtn}>
              <Text style={styles.queueBtnText}>查看队列 ({queue.length})</Text>
            </TouchableOpacity>
          </View>

          {/* 歌词 */}
          {lyricLines.length > 0 && (
            <FlatList
              ref={flatListRef}
              data={lyricLines}
              keyExtractor={(_, i) => String(i)}
              style={styles.lyricsList}
              renderItem={({ item, index }) => (
                <Text style={[
                  styles.lyricLine,
                  index === currentLineIdx && styles.lyricLineActive
                ]}>
                  {item.text}
                </Text>
              )}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* 进度条 */}
          <View style={styles.progressWrap}>
            <Slider
              style={{ width: width - 48 }}
              minimumValue={0}
              maximumValue={Math.max(duration, 1)}
              value={currentTime}
              onSlidingComplete={seekTo}
              minimumTrackTintColor="#e74c3c"
              maximumTrackTintColor="#444"
              thumbTintColor="#e74c3c"
            />
            <View style={styles.timeRow}>
              <Text style={styles.time}>{formatTime(currentTime)}</Text>
              <Text style={styles.time}>{formatTime(duration)}</Text>
            </View>
          </View>

          {/* 控制按钮 */}
          <View style={styles.controls}>
            <TouchableOpacity onPress={prev}>
              <Ionicons name="play-skip-back" size={32} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
              <Ionicons
                name={isPlaying ? 'pause-circle' : 'play-circle'}
                size={64}
                color="#e74c3c"
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={next}>
              <Ionicons name="play-skip-forward" size={32} color="#fff" />
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* 队列弹窗 */}
      <Modal
        visible={showQueue}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowQueue(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>播放队列</Text>
              <TouchableOpacity onPress={() => setShowQueue(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={queue}
              keyExtractor={(item, index) => `${item.id}-${index}`}
              renderItem={({ item, index }) => {
                const isCurrent = song?.id === item.id;
                return (
                  <TouchableOpacity
                    style={styles.queueItem}
                    onPress={() => {
                      usePlayerStore.getState().setQueue(queue, index);
                      setShowQueue(false);
                    }}
                    onLongPress={() => {
                      Alert.alert(
                        item.name,
                        undefined,
                        [
                          { text: '取消', style: 'cancel' },
                          { text: '移到顶部', onPress: () => moveToTop(index) },
                          { text: '移除', style: 'destructive', onPress: () => removeFromQueue(index) },
                        ],
                      );
                    }}
                  >
                    <View style={styles.queueItemInfo}>
                      <Text
                        style={[styles.queueItemName, isCurrent && styles.queueItemActive]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      <Text style={styles.queueItemArtist}>{item.artist}</Text>
                    </View>
                    {isCurrent && (
                      <Ionicons name="play" size={16} color="#e74c3c" />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>队列为空</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center' },
  coverWrap: { marginTop: 40 },
  cover: { width: 280, height: 280, borderRadius: 16 },
  infoWrap: { marginTop: 24, alignItems: 'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  artist: { color: '#888', fontSize: 14, marginTop: 6 },
  progressWrap: { marginTop: 32, alignItems: 'center' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', width: width - 48, marginTop: 4 },
  time: { color: '#666', fontSize: 12 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
    gap: 40,
  },
  playBtn: { marginHorizontal: 8 },
  lyricsList: { height: 120, marginTop: 16, marginHorizontal: 24 },
  lyricLine: { color: '#666', fontSize: 14, textAlign: 'center', marginVertical: 4 },
  lyricLineActive: { color: '#e74c3c', fontSize: 15, fontWeight: '600' },
  queueBtn: { marginTop: 12 },
  queueBtnText: { color: '#e74c3c', fontSize: 14 },
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
  // 全屏歌词视图样式
  lyricsFullWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  lyricsFullList: {
    height: 400,
    width: '100%',
  },
  lyricsFullContent: {
    paddingVertical: 20,
  },
});
