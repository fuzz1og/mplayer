import { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  Modal, FlatList, Animated, Easing,
} from 'react-native';
import { Music, SkipBack, CirclePause, CirclePlay, SkipForward, ListMusic, X, Play, Loader2 } from 'lucide-react-native';
import { invalidateCoverUrl } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay, playSong, fetchLrcInBackground } from '../services/audioPlayer';
import { colors, spacing, radius, textVariants } from '../theme/tokens';
import { useResolvedCover } from '../hooks/useResolvedCover';

export default function PlayerBar() {
  const insets = useSafeAreaInsets();
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const queue = usePlayerStore(s => s.queue);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);
  const setQueue = usePlayerStore(s => s.setQueue);
  const setShowPlayer = usePlayerStore(s => s.setShowPlayer);
  const preparing = usePlayerStore(s => s.preparing);
  const [showQueue, setShowQueue] = useState(false);
  // 播放准备中：播放按钮旋转加载反馈（点击后解析直链的等待期）
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!preparing) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [preparing, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  // 封面加载失败 → 占位图标 + 懒刷新兜底（搜索补新封面，写回后自动恢复）
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => { setCoverFailed(false); }, [currentSong?.cover]);
  const coverUrl = useResolvedCover(currentSong?.cover);
  useEffect(() => { setCoverFailed(false); }, [coverUrl]);
  const handleCoverError = () => {
    setCoverFailed(true);
    if (currentSong) {
      // 封面自身失效：清除解析缓存（归一化 key 命中失效直链会永远失败占位）
      // 再强制搜索补新签名封面
      void invalidateCoverUrl(currentSong.cover || '');
      void fetchLrcInBackground(currentSong, true, true);
    }
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
        {coverUrl && !coverFailed ? (
          <Image source={{ uri: coverUrl }} style={styles.cover} onError={handleCoverError} />
        ) : (
          <Music size={24} color={colors.textTertiary} />
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
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 2 }}
          >
            <SkipBack size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); togglePlay(); }}
            style={styles.btn}
            hitSlop={{ top: 4, bottom: 4 }}
            disabled={preparing}
          >
            {preparing ? (
              <Animated.View style={{ transform: [{ rotate }] }}>
                <Loader2 size={36} color={colors.accent} />
              </Animated.View>
            ) : isPlaying ? (
              <CirclePause size={36} color={colors.accent} />
            ) : (
              <CirclePlay size={36} color={colors.accent} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); next(); const s = usePlayerStore.getState().currentSong; if (s) playSong(s); }}
            style={styles.btn}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 6 }}
          >
            <SkipForward size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              setShowQueue(true);
            }}
            style={styles.btn}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 12 }}
          >
            <ListMusic size={24} color={colors.textSecondary} />
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
                <X size={24} color={colors.textSecondary} />
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
                    {isCurrent && <Play size={16} color={colors.accent} />}
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
    backgroundColor: colors.bgSurface,
    // 平铺贴底条：顶部 hairline 与列表分隔（无圆角/阴影，与整体设计语言一致）
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  containerEmpty: {
    opacity: 0.6,
  },
  coverWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.bgHover,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: spacing[3],
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
  },
  info: { flex: 1, marginRight: spacing[3] },
  title: { ...textVariants.subhead, fontWeight: '600', color: colors.textPrimary },
  artist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  textEmpty: { color: colors.textTertiary },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btn: { padding: spacing[1] },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '60%',
    paddingBottom: spacing[8],
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderDefault,
  },
  modalTitle: { ...textVariants.title, color: colors.textPrimary },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderDefault,
  },
  queueItemInfo: { flex: 1, marginRight: 12 },
  queueItemName: { ...textVariants.body, fontWeight: '400', color: colors.textPrimary },
  queueItemActive: { color: colors.accent },
  queueItemArtist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  emptyText: { ...textVariants.footnote, color: colors.textTertiary, textAlign: 'center', marginTop: spacing[10] },
});
