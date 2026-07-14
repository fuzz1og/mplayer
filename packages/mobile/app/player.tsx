import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions, FlatList,
  PanResponder, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Slider from '@react-native-community/slider';
import { usePlayerStore } from '../stores/playerStore';
import { useFavoriteStore } from '../stores/favoriteStore';
import { togglePlay, seekTo, playSong } from '../services/audioPlayer';
import { showAddToPlaylistPicker } from '../utils/playlistUtils';
import { parseLRC, musicApi, findCurrentLyricIndex } from '@mplayer/core';
import type { LyricLine } from '@mplayer/core';
import { useSettingsStore, PLAY_MODES } from '../stores/settingsStore';
import type { PlayMode } from '../stores/settingsStore';

const { width } = Dimensions.get('window');

export default function PlayerPage() {
  const song = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const isFav = useFavoriteStore(s => s.isFavorite(song?.id || ''));
  const addFavorite = useFavoriteStore(s => s.addFavorite);
  const removeFavorite = useFavoriteStore(s => s.removeFavorite);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);
  const playMode = useSettingsStore(s => s.playMode);
  const setPlayMode = useSettingsStore(s => s.setPlayMode);

  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [currentLineIdx, setCurrentLineIdx] = useState(-1);
  const [showLyrics, setShowLyrics] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lyricsFlatListRef = useRef<FlatList>(null);
  const rotation = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  // 唱片旋转动画
  useEffect(() => {
    if (isPlaying) {
      Animated.loop(
        Animated.timing(rotation, {
          toValue: 1,
          duration: 8000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      rotation.stopAnimation();
    }
    return () => rotation.stopAnimation();
  }, [isPlaying, rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const MODE_ICONS: Record<PlayMode, string> = {
    '顺序播放': 'repeat',
    '单曲循环': 'repeat-once',
    '列表循环': 'repeat',
    '随机播放': 'shuffle',
  };

  const cyclePlayMode = () => {
    const idx = PLAY_MODES.indexOf(playMode);
    const next = PLAY_MODES[(idx + 1) % PLAY_MODES.length];
    setPlayMode(next);
  };

  useEffect(() => {
    if (!song) router.back();
  }, [song]);

  // 加载歌词（带取消 + 缓存）
  useEffect(() => {
    if (!song?.lrc) { setLyricLines([]); return; }
    const abort = new AbortController();
    const cacheKey = song.lrc;
    // 检查内存缓存
    const cached = lyricCache.get(cacheKey);
    if (cached) {
      setLyricLines(cached);
      return;
    }
    musicApi.getLyrics(song.lrc).then(lrc => {
      if (abort.signal.aborted) return;
      const parsed = parseLRC(lrc);
      lyricCache.set(cacheKey, parsed.lines);
      setLyricLines(parsed.lines);
    }).catch(() => {
      if (!abort.signal.aborted) setLyricLines([]);
    });
    return () => abort.abort();
  }, [song?.lrc]);

  // 歌词缓存（模块级，避免页面重挂载重新请求）
  const lyricCache = useRef(new Map<string, LyricLine[]>()).current;

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

  const toggleFavorite = () => {
    if (!song) return;
    if (isFav) removeFavorite(song.id);
    else addFavorite(song);
  };

  const handleAddToPlaylist = () => {
    if (!song) return;
    showAddToPlaylistPicker(song);
  };

  const handleDownload = () => {
    // 下载功能即将推出
  };

  const handlePrev = () => {
    prev();
    const newSong = usePlayerStore.getState().currentSong;
    if (newSong) playSong(newSong);
  };

  const handleNext = () => {
    next();
    const newSong = usePlayerStore.getState().currentSong;
    if (newSong) playSong(newSong);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => {
        return (Math.abs(gs.dx) > 30 && Math.abs(gs.dy) < 20) || Math.abs(gs.dy) > 30;
      },
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) panY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 80) {
          Animated.timing(panY, {
            toValue: Dimensions.get('window').height,
            duration: 200,
            useNativeDriver: true,
          }).start(() => router.back());
        } else {
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
          if (Math.abs(gs.dy) < 20) {
            if (gs.dx < -50) setShowLyrics(true);
            else if (gs.dx > 50) setShowLyrics(false);
          }
        }
      },
    })
  ).current;

  if (!song) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} {...panResponder.panHandlers}>
      <StatusBar style="light" />
      <Stack.Screen options={{
        headerShown: true,
        title: '',
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()}>
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
              style={styles.lyricsFullList}
              contentContainerStyle={styles.lyricsFullContent}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => seekTo(item.time)}
                  style={{ paddingVertical: 4 }}
                >
                  <Text style={[
                    styles.lyricsFullLine,
                    index === currentLineIdx && styles.lyricsFullLineActive
                  ]}>
                    {item.text}
                  </Text>
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <Text style={{ color: '#666', fontSize: 16 }}>暂无歌词</Text>
          )}
        </View>
      ) : (
        <Animated.View style={{ flex: 1, alignItems: 'center', transform: [{ translateY: panY }] }}>
          {/* 专辑封面 */}
          <View style={styles.coverWrap}>
            <Animated.Image
              source={{ uri: song.cover || 'https://via.placeholder.com/300' }}
              style={[styles.cover, { transform: [{ rotate: spin }] }]}
            />
          </View>

          {/* 歌曲信息 */}
          <View style={styles.infoWrap}>
            <Text style={styles.title}>{song.name}</Text>
            <Text style={styles.artist}>{song.artist}</Text>
          </View>

          {/* 歌词 */}
          {lyricLines.length > 0 && (
            <FlatList
              ref={flatListRef}
              data={lyricLines}
              style={styles.lyricsList}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => seekTo(item.time)}
                >
                  <Text style={[
                    styles.lyricLine,
                    index === currentLineIdx && styles.lyricLineActive
                  ]}>
                    {item.text}
                  </Text>
                </TouchableOpacity>
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
            <TouchableOpacity onPress={handlePrev}>
              <Ionicons name="play-skip-back" size={32} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
              <Ionicons
                name={isPlaying ? 'pause-circle' : 'play-circle'}
                size={64}
                color="#e74c3c"
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleNext}>
              <Ionicons name="play-skip-forward" size={32} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* 操作按钮行 */}
          <View style={styles.actionRow}>
            <TouchableOpacity onPress={cyclePlayMode} style={styles.actionBtn}>
              <MaterialCommunityIcons name={MODE_ICONS[playMode] as any} size={24} color="#e74c3c" />
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleFavorite} style={styles.actionBtn}>
              <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={24} color={isFav ? '#e74c3c' : '#fff'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleAddToPlaylist} style={styles.actionBtn}>
              <Ionicons name="add-circle-outline" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDownload} style={styles.actionBtn}>
              <Ionicons name="download-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
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
  coverWrap: { marginTop: 20 },
  cover: { width: 240, height: 240, borderRadius: 16 },
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    gap: 24,
  },
  actionBtn: { padding: 8 },
  lyricsList: { flex: 1, marginTop: 16, marginHorizontal: 24 },
  lyricLine: { color: '#666', fontSize: 15, textAlign: 'center', marginVertical: 6 },
  lyricLineActive: { color: '#e74c3c', fontSize: 16, fontWeight: '600' },
  lyricsFullLine: { color: '#888', fontSize: 18, textAlign: 'center', marginVertical: 8, lineHeight: 28 },
  lyricsFullLineActive: { color: '#e74c3c', fontSize: 20, fontWeight: '600', lineHeight: 30 },
  // 全屏歌词视图样式
  lyricsFullWrap: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    width: '100%',
  },
  lyricsFullList: {
    flex: 1,
    width: '100%',
  },
  lyricsFullContent: {
    paddingVertical: 20,
  },
});
