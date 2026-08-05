import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions, FlatList,
  PanResponder, Animated, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, SkipBack, CirclePlay, CirclePause, SkipForward, Repeat1, Repeat, Shuffle, Heart, CirclePlus, Download } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import Slider from '@react-native-community/slider';
import { usePlayerStore } from '../stores/playerStore';
import { useFavoriteStore } from '../stores/favoriteStore';
import { togglePlay, seekTo, playSong, fetchLrcInBackground } from '../services/audioPlayer';
import { downloadSong } from '../services/downloadService';
import AddToPlaylistModal from './AddToPlaylistModal';
import { parseLRC, musicApi, findCurrentLyricIndex } from '@mplayer/core';
import type { LyricLine } from '@mplayer/core';
import { useSettingsStore, PLAY_MODES } from '../stores/settingsStore';
import type { PlayMode } from '../stores/settingsStore';
import { SOURCE_LABELS } from '../stores/sourceStore';

const { width } = Dimensions.get('window');

interface Props {
  onClose: () => void;
}

export default function PlayerOverlay({ onClose }: Props) {
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
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lyricsFlatListRef = useRef<FlatList>(null);
  const rotation = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const lyricCache = useRef(new Map<string, LyricLine[]>()).current;
  const onCloseRef = useRef(onClose);
  const slideAnim = useRef<Animated.CompositeAnimation | null>(null);
  const insets = useSafeAreaInsets();
  onCloseRef.current = onClose;

  // 滑入动画
  useEffect(() => {
    const anim = Animated.spring(panY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 50,
      friction: 10,
    });
    slideAnim.current = anim;
    anim.start();
    return () => anim.stop();
  }, []);

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

  const MODE_ICONS: Record<PlayMode, LucideIcon> = {
    '单曲循环': Repeat1,
    '列表循环': Repeat,
    '随机播放': Shuffle,
  };

  const ModeIcon = MODE_ICONS[playMode];

  const cyclePlayMode = () => {
    const idx = PLAY_MODES.indexOf(playMode);
    const nextMode = PLAY_MODES[(idx + 1) % PLAY_MODES.length];
    setPlayMode(nextMode);
  };

  useEffect(() => {
    if (!song) onCloseRef.current();
  }, [song]);

  // 封面加载失败 → 占位唱片 + 懒刷新兜底（搜索补新封面，写回后自动恢复）
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => { setCoverFailed(false); }, [song?.cover]);
  const handleCoverError = () => {
    setCoverFailed(true);
    if (song) void fetchLrcInBackground(song, true);
  };

  // 加载歌词：优先歌曲自带 lrc URL；今日推荐/歌单/歌手页的歌曲 lrc 为空，
  // 用网易云 songId 兜底拉歌词
  const [lyricsLoading, setLyricsLoading] = useState(false);
  useEffect(() => {
    if (!song) { setLyricLines([]); setLyricsLoading(false); return; }
    const abort = new AbortController();
    const cacheKey = song.lrc || (song.sourceType === 'netease' ? `songid:${song.id}` : '');
    if (!cacheKey) { setLyricLines([]); setLyricsLoading(false); return; }
    const cached = lyricCache.get(cacheKey);
    if (cached) {
      setLyricLines(cached);
      setLyricsLoading(false);
      return;
    }
    setLyricsLoading(true);
    const load = song.lrc
      ? musicApi.getLyrics(song.lrc)
      : musicApi.getLyricsBySongId(song.id);
    load.then(lrc => {
      if (abort.signal.aborted) return;
      const parsed = parseLRC(lrc);
      lyricCache.set(cacheKey, parsed.lines);
      setLyricLines(parsed.lines);
    }).catch(() => {
      if (!abort.signal.aborted) {
        setLyricLines([]);
        // 歌曲自带 lrc URL 可能已失效（歌单/收藏缓存）→ 强制搜索兜底补歌词
        void fetchLrcInBackground(song, true);
      }
    }).finally(() => {
      if (!abort.signal.aborted) setLyricsLoading(false);
    });
    return () => abort.abort();
  }, [song?.lrc, song?.id]);

  // 更新歌词高亮
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

  const handleDownload = () => {
    if (!song) return;
    downloadSong(song)
      .then(() => Alert.alert('提示', `《${song.name}》下载完成，可在下载页播放`))
      .catch(() => Alert.alert('提示', `《${song.name}》下载失败，请重试`));
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

  const dismissWithAnimation = () => {
    Animated.timing(panY, {
      toValue: Dimensions.get('window').height,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onCloseRef.current());
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
          }).start(() => onCloseRef.current());
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
    <SafeAreaView style={styles.container} edges={['top']} {...panResponder.panHandlers}>
      <StatusBar style="light" />

      <Animated.View style={[styles.contentWrap, { transform: [{ translateY: panY }], paddingBottom: insets.bottom + 24 }]}>
        {/* 自定义顶部栏 */}
        <View style={styles.customHeader}>
          <TouchableOpacity onPress={dismissWithAnimation}>
            <ChevronDown size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowLyrics(v => !v)}>
            <Text style={{ color: '#e74c3c', fontSize: 16, fontWeight: '600' }}>
              {showLyrics ? '封' : '词'}
            </Text>
          </TouchableOpacity>
        </View>

        {showLyrics ? (
          /* 全屏歌词 */
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
          <>
            {/* 唱机区域 */}
            <View style={styles.turntableWrap}>
              <View style={styles.plinth}>
                <View style={styles.platter} />
                <Animated.Image
                  source={coverFailed ? undefined : { uri: song.cover || 'https://via.placeholder.com/300' }}
                  style={[styles.cover, { transform: [{ rotate: spin }] }]}
                  onError={handleCoverError}
                />
                {/* 唱臂 */}
                <View style={styles.tonearmPivot} />
                <View style={styles.tonearmRod} />
              </View>
            </View>

            {/* 歌曲信息 */}
            <View style={styles.infoWrap}>
              <Text style={styles.title}>{song.name}</Text>
              <View style={styles.infoRow}>
                <Text style={styles.artist} numberOfLines={1}>{song.artist}</Text>
                {song.sourceType !== 'local' && (
                  <View style={styles.sourceTag}>
                    <Text style={styles.sourceTagText}>{SOURCE_LABELS[song.sourceType] || song.sourceType}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* 歌词预览：始终占位,加载中显示骨架屏,避免歌词到达时布局跳动 */}
            {lyricLines.length > 0 ? (
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
            ) : lyricsLoading ? (
              <View style={styles.lyricsList}>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.skeletonLine,
                      { width: `${82 - (i % 3) * 12}%` },
                    ]}
                  />
                ))}
              </View>
            ) : null}

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
                <SkipBack size={32} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
                {isPlaying ? (
                  <CirclePause size={64} color="#e74c3c" />
                ) : (
                  <CirclePlay size={64} color="#e74c3c" />
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={handleNext}>
                <SkipForward size={32} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* 操作按钮 */}
            <View style={styles.actionRow}>
              <TouchableOpacity onPress={cyclePlayMode} style={styles.actionBtn}>
                <ModeIcon size={24} color="#e74c3c" />
              </TouchableOpacity>
              <TouchableOpacity onPress={toggleFavorite} style={styles.actionBtn}>
                <Heart size={24} color={isFav ? '#e74c3c' : '#fff'} fill={isFav ? '#e74c3c' : 'none'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowPlaylistModal(true)} style={styles.actionBtn}>
                <CirclePlus size={24} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDownload} style={styles.actionBtn}>
                <Download size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </>
        )}
      </Animated.View>

      <AddToPlaylistModal
        visible={showPlaylistModal}
        song={song}
        onClose={() => setShowPlaylistModal(false)}
      />
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
  container: { flex: 1, backgroundColor: 'transparent', alignItems: 'center' },
  contentWrap: { flex: 1, alignItems: 'center', backgroundColor: '#1a1a2e', width: '100%' },
  customHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    height: 44,
  },
  // 唱机底座
  turntableWrap: {
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plinth: {
    width: 280,
    height: 280,
    borderRadius: 20,
    backgroundColor: '#222240',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  platter: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
  },
  cover: {
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 3,
    borderColor: '#1a1a1a',
  },
  // 唱臂
  tonearmPivot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#888',
    borderWidth: 2,
    borderColor: '#bbb',
    zIndex: 10,
  },
  tonearmRod: {
    position: 'absolute',
    top: 12,
    right: 10,
    width: 4,
    height: 183,
    backgroundColor: '#999',
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
    transformOrigin: 'top',
    zIndex: 9,
  },
  infoWrap: { marginTop: 12, alignItems: 'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  artist: { color: '#888', fontSize: 14, flexShrink: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  sourceTag: {
    marginLeft: 8,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#2a2a4a',
  },
  sourceTagText: { color: '#bbb', fontSize: 10 },
  progressWrap: { marginTop: 16, alignItems: 'center' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', width: width - 48, marginTop: 4 },
  time: { color: '#666', fontSize: 12 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
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
  // 歌词骨架屏：行高/间距与 lyricLine 一致,占位稳定避免加载后跳动
  skeletonLine: {
    alignSelf: 'center',
    height: 15,
    borderRadius: 7,
    backgroundColor: '#2a2a4a',
    marginVertical: 6,
  },
  lyricsFullLine: { color: '#888', fontSize: 18, textAlign: 'center', marginVertical: 8, lineHeight: 28 },
  lyricsFullLineActive: { color: '#e74c3c', fontSize: 20, fontWeight: '600', lineHeight: 30 },
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
