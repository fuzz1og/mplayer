import { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, Image, Pressable, StyleSheet, Animated, Easing,
} from 'react-native';
import { Music, SkipBack, CirclePause, CirclePlay, SkipForward, ListMusic, Loader2 } from 'lucide-react-native';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay, playSong, fetchLrcInBackground } from '../services/audioPlayer';
import { radius, spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import ScalePress from './ScalePress';
import QueueListModal from './QueueListModal';
import ChromeBlur from './ChromeBlur';
import { tapLight } from '../utils/haptics';

export default function PlayerBar() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);
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
  // 封面加载失败 → 占位图标 + 懒刷新兜底（搜索补新封面，写回后自动恢复）。
  // 原生 <Image> 直连 CDN 直链渲染
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => { setCoverFailed(false); }, [currentSong?.cover]);
  const handleCoverError = () => {
    setCoverFailed(true);
    if (currentSong) {
      void fetchLrcInBackground(currentSong, true, true);
    }
  };

  return (
    <ChromeBlur style={styles.blurWrap}>
    {/* 整栏点击主体用无动画 Pressable（#261 判例）：条内已有 4 个 ScalePress
        控制钮，整栏再缩放/变淡会双层反馈叠加，观感混乱 */}
    <Pressable
      style={[styles.container, !currentSong && styles.containerEmpty]}
      onPress={() => currentSong && setShowPlayer(true)}
      disabled={!currentSong}
    >
      {/* 专辑封面 */}
      <View style={styles.coverWrap}>
        {currentSong?.cover && !coverFailed ? (
          <Image source={{ uri: currentSong.cover }} style={styles.cover} onError={handleCoverError} />
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
          {currentSong ? currentSong.artist : '选择一首歌曲开始播放'}
        </Text>
      </View>

      {/* 控制按钮 */}
      {currentSong && (
        <View style={styles.controls}>
          <ScalePress
            onPress={(e) => { e?.stopPropagation(); prev(); const s = usePlayerStore.getState().currentSong; if (s) playSong(s); }}
            style={styles.btn}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 2 }}
          >
            <SkipBack size={24} color={colors.textSecondary} />
          </ScalePress>
          <ScalePress
            onPress={(e) => { e?.stopPropagation(); togglePlay(); tapLight(); }}
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
          </ScalePress>
          <ScalePress
            onPress={(e) => { e?.stopPropagation(); next(); const s = usePlayerStore.getState().currentSong; if (s) playSong(s); }}
            style={styles.btn}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 6 }}
          >
            <SkipForward size={24} color={colors.textSecondary} />
          </ScalePress>
          <ScalePress
            onPress={(e) => {
              e?.stopPropagation();
              setShowQueue(true);
            }}
            style={styles.btn}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 12 }}
          >
            <ListMusic size={24} color={colors.textSecondary} />
          </ScalePress>
        </View>
      )}
      {/* 队列弹层（#186 #5：抽共享 QueueListModal，基于 BottomSheet 壳） */}
      <QueueListModal visible={showQueue} onClose={() => setShowQueue(false)} />
    </Pressable>
    </ChromeBlur>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 毛玻璃由 ChromeBlur 提供（ADR-0005），容器仅排版
  blurWrap: {
    overflow: 'hidden',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
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
