import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  PanResponder, Animated, Alert, Dimensions, useWindowDimensions, Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, SkipBack, CirclePlay, CirclePause, SkipForward, Repeat1, Repeat, Shuffle, Heart, CirclePlus, Download, Music, MicVocal, ListMusic, MessageSquareText, Disc3, X, MoreVertical } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import Slider from '@react-native-community/slider';
import { usePlayerStore } from '../stores/playerStore';
import { useFavoriteStore } from '../stores/favoriteStore';
import { togglePlay, seekTo, playSong, fetchLrcInBackground } from '../services/audioPlayer';
import { downloadSong } from '../services/downloadService';
import AddToPlaylistModal from './AddToPlaylistModal';
import QueueListModal from './QueueListModal';
import { useResolvedCover } from '../hooks/useResolvedCover';
import BottomSheet from './BottomSheet';
import { parseLRC, musicApi, findCurrentLyricIndex, invalidateCoverUrl, songUsesSongidLyrics, isSodaSource } from '@mplayer/core';
import type { LyricLine } from '@mplayer/core';
import { useSettingsStore, PLAY_MODES } from '../stores/settingsStore';
import type { PlayMode } from '../stores/settingsStore';
import { SOURCE_LABELS } from '../stores/sourceStore';
import {radius, shadow, spacing, textVariants, turntable, playerForeground, playerBackground} from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { springs, projectMomentum, rubberband } from '../theme/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { tapLight } from '../utils/haptics';
import ScalePress from './ScalePress';

/** 投影落点超过屏高此比例即判关：快甩从任意位置都能关，慢拖半途自然回弹 */
const DISMISS_PROJECT_RATIO = 0.35;

/** 唱盘尺寸（#186 #4 + 真机反馈）：底部操作行合并进控制行后省出空间，唱盘加大，
 *  按屏高 36% 缩放（SE 667dp → ~240，常见 731dp → ~263） */
function plinthSize(width: number, winH: number): number {
  return Math.max(200, Math.min(width - 96, winH * 0.4, 280));
}
/** 进度条/时间行宽度：唱盘同轴的 `屏宽 - 48`，统一此处防散落魔数（#186 #4） */
function sliderWidth(width: number): number {
  return width - 48;
}

interface Props {
  onClose: () => void;
}

export default function PlayerOverlay({ onClose }: Props) {
  const { colors, isDark } = useTheme();
  // #186 #4：旋转/折叠屏实时取宽高，避免模块顶层 Dimensions 取值过期
  const { width: winW, height: winH } = useWindowDimensions();
  // 播放器前景色：随背景明暗切换（暗背景→亮字 / 浅背景→深字，iOS 全屏双端适配）
  const fg = useMemo(() => makeFg(isDark), [isDark]);
  const styles = useMemo(() => makeStyles(colors, fg), [colors, fg]);
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
  // #186 #5：全屏播放器队列入口（与迷你播放栏共用 QueueListModal）
  const [showQueueModal, setShowQueueModal] = useState(false);
  // 右上角「更多」弹层（真机反馈：模式/加歌单/下载收进弹层，减轻底部五键负担）
  const [showMoreModal, setShowMoreModal] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lyricsFlatListRef = useRef<FlatList>(null);
  const rotation = useRef(new Animated.Value(0)).current;
  // #186 #10：唱臂起落——播放落臂 / 暂停抬臂，Animated.Value 0=抬 1=落
  const tonearm = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(winH)).current;
  const lyricCache = useRef(new Map<string, LyricLine[]>()).current;
  const onCloseRef = useRef(onClose);
  const slideAnim = useRef<Animated.CompositeAnimation | null>(null);
  const insets = useSafeAreaInsets();
  onCloseRef.current = onClose;

  // ── 开合动画：常规 = sheet 弹簧滑入 + 减淡缩放联动（P0-2）；减弱动效 = 原地淡入（无大位移，§14）──
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  // P0-2：入场 scale 0.98→1 与 translateY 同 sheet 弹簧联动，dismiss 同步淡出
  const scale = useRef(new Animated.Value(0.98)).current;

  // P1-4：收藏/循环切换的 icon pop（1→1.15→1）即时反馈
  const favPop = useRef(new Animated.Value(1)).current;
  const modePop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      panY.stopAnimation();
      panY.setValue(0);
      scale.setValue(1);
      opacity.setValue(0);
      const fade = Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      });
      fade.start(({ finished }) => { if (finished) tapLight(); });
      return () => fade.stop();
    }
    const anim = Animated.parallel([
      Animated.spring(panY, { toValue: 0, useNativeDriver: true, ...springs.sheet }),
      Animated.spring(opacity, { toValue: 1, useNativeDriver: true, ...springs.sheet }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...springs.sheet }),
    ]);
    slideAnim.current = anim;
    anim.start(({ finished }) => { if (finished) tapLight(); });
    return () => anim.stop();
  }, [reducedMotion]);

  /** P1-4：一次 pop（1→1.15→1）即时反馈；减弱动效时只保留触觉 */
  const popValue = (av: Animated.Value) => {
    tapLight();
    if (reducedMotion) return;
    Animated.sequence([
      Animated.spring(av, { toValue: 1.15, useNativeDriver: true, ...springs.pressScale }),
      Animated.spring(av, { toValue: 1, useNativeDriver: true, ...springs.pressScale }),
    ]).start();
  };

  // 唱片旋转动画（减弱动效时停止循环装饰动画）
  // 词/封横向分页动画（真机反馈 #2）：两页（封面/歌词）并排平移切换（苹果式），
  // 非瞬间切换。0 = 封面页，-winW = 歌词页。点击图标/横向滑动均触发该动画。
  const pageX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(pageX, {
      toValue: showLyrics ? -winW : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [showLyrics, pageX, winW]);

  // 封面匀速旋转（真机反馈 #2）：Animated.loop 每圈结束跳回 0° 视觉断裂。
  // 改为 JS 驱动自增角度——播放时 rAF 匀速推进、暂停时冻结当前角度、恢复时续转。
  const angleRef = useRef(0);
  const lastTickRef = useRef(0);
  const ROTATE_MS = 12000; // 一圈 12s，速度与唱盘旋转观感一致
  useEffect(() => {
    if (!isPlaying || reducedMotion) {
      rotation.stopAnimation();
      return;
    }
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      angleRef.current = (angleRef.current + (now - lastTickRef.current) / ROTATE_MS) % 1;
      lastTickRef.current = now;
      rotation.setValue(angleRef.current);
      raf = requestAnimationFrame(tick);
    };
    lastTickRef.current = Date.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, rotation, reducedMotion]);

  // #186 #10：唱臂起落——播放落臂（45°→12°），暂停抬臂（回 45°），spring 物理；
  // 减弱动效时静态保持落臂（不循环装饰），reducedMotion 下仍随播放落/抬（用户可感知状态）
  useEffect(() => {
    Animated.spring(tonearm, {
      toValue: isPlaying ? 1 : 0,
      damping: 18,
      stiffness: 180,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [isPlaying, tonearm]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
    // 值在 0~1 内 mod 循环（角度 0~360°），无需外推
  });
  const armAngle = tonearm.interpolate({
    inputRange: [0, 1],
    outputRange: ['45deg', '12deg'],
  });

  const MODE_ICONS: Record<PlayMode, LucideIcon> = {
    '单曲循环': Repeat1,
    '列表循环': Repeat,
    '随机播放': Shuffle,
  };

  const ModeIcon = MODE_ICONS[playMode];

  const cyclePlayMode = () => {
    popValue(modePop);
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
  const coverUrl = useResolvedCover(song?.cover);
  useEffect(() => { setCoverFailed(false); }, [coverUrl]);
  const handleCoverError = () => {
    setCoverFailed(true);
    if (song) {
      // 封面自身失效：清除解析缓存后强制换新签名封面（见 fetchLrcInBackground）
      void invalidateCoverUrl(song.cover || '');
      void fetchLrcInBackground(song, true, true);
    }
  };

  // 加载歌词：优先歌曲自带 lrc URL；今日推荐/歌单/歌手页的歌曲 lrc 为空，
  // 用网易云 songId 兜底拉歌词；汽水用分享页免登录结构化歌词（getSodaLyrics）
  const [lyricsLoading, setLyricsLoading] = useState(false);
  useEffect(() => {
    if (!song) { setLyricLines([]); setLyricsLoading(false); return; }
    const abort = new AbortController();
    const cacheKey = song.lrc
      ? song.lrc
      : songUsesSongidLyrics(song.sourceType) ? `songid:${song.id}` : '';
    if (!cacheKey) {
      setLyricLines([]);
      setLyricsLoading(false);
      // 热榜点播的搜索腿可能未命中（lrc 空）→ 后台搜索补 lrc，回填后本 effect 重跑
      void fetchLrcInBackground(song, true);
      return;
    }
    const cached = lyricCache.get(cacheKey);
    if (cached) {
      setLyricLines(cached);
      setLyricsLoading(false);
      return;
    }
    setLyricsLoading(true);
    const load = song.lrc
      ? musicApi.getLyrics(song.lrc)
      : isSodaSource(song.sourceType)
        ? musicApi.getSodaLyrics(String(song.id))
        : musicApi.getLyricsBySongId(song.id);
    load.then(lrc => {
      if (abort.signal.aborted) return;
      const parsed = parseLRC(lrc);
      lyricCache.set(cacheKey, parsed.lines);
      setLyricLines(parsed.lines);
      // 拿到空词（lrc URL 被拒/无词）≠ 加载失败不抛错：非网易源再给搜索兜底
      // 一次机会（网易 by-id 已是权威答案，纯音乐不再白搜）。结果同 URL 时
      // fetchLrcInBackground 内部按无变化返回，不会循环。
      if (parsed.lines.length === 0 && song.sourceType !== 'netease') {
        void fetchLrcInBackground(song, true);
      }
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

  // P1-3：歌词当前行平滑过渡——active 行用轻量 Animated（仅当前行渲染 Animated.Text），
  // 行高固定（避免 scrollToIndex 抖动），入场 scale+颜色渐入；离开行直接回灰。
  const lyricPop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (currentLineIdx < 0) return;
    lyricPop.setValue(0);
    Animated.spring(lyricPop, { toValue: 1, useNativeDriver: true, ...springs.pressScale }).start();
    return () => lyricPop.stopAnimation();
  }, [currentLineIdx, lyricPop]);

  const toggleFavorite = () => {
    if (!song) return;
    popValue(favPop);
    if (isFav) removeFavorite(song.id);
    else addFavorite(song);
  };

  const handleDownload = () => {
    if (!song) return;
    downloadSong(song)
      .then(() => Alert.alert('提示', `《${song.name}》下载完成，可在本地歌曲页播放`))
      .catch((e) => {
        console.error('[player]', `下载失败《${song.name}》:`, e);
        Alert.alert('下载失败', `《${song.name}》: ${e instanceof Error ? e.message : String(e)}`);
      });
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

  // ── 手势物理（ADR-0004）：可中断、速度继承、动量投影、橡皮筋 ──
  const dragStartValue = useRef(0);                 // 抓取瞬间面板呈现值（支持中途抓住动画）
  const gestureBaseDy = useRef<number | null>(null); // 首个 move 事件校准基准（消除激活前位移跳变）
  const lastY = useRef(0);                          // 最近一帧面板位置（release 同步可读）
  // 词/封分页手势（真机反馈 #2）：水平方向接管 pageX 跟手 + 松手动画落位
  const dragAxis = useRef<'x' | 'y' | null>(null);
  const pageBase = useRef(0);                       // 抓取瞬间 pageX 呈现值（支持中途抓住分页动画）

  const dismiss = (velocityY = 0) => {
    if (reducedMotion) {
      // 减弱动效：原地淡出，不做大位移
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true })
        .start(({ finished }) => { if (finished) { tapLight(); onCloseRef.current(); } });
      return;
    }
    // P0-2：下滑关闭时 translateY 弹簧下滑，同时淡出 + 轻微放大（同步减淡缩放）
    Animated.parallel([
      Animated.spring(panY, {
        toValue: Dimensions.get('window').height, // 现取现用，旋转/折叠屏不取过期值
        velocity: velocityY,                      // 继承松手速度，无匀速刹车感
        useNativeDriver: true,
        ...springs.sheet,
      }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.04, useNativeDriver: true, ...springs.sheet }),
    ]).start(({ finished }) => {
      if (finished) { tapLight(); onCloseRef.current(); }
    });
  };

  const snapBack = (velocityY = 0) => {
    Animated.spring(panY, {
      toValue: 0,
      velocity: velocityY,
      useNativeDriver: true,
      ...springs.sheet,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => {
        return (Math.abs(gs.dx) > 30 && Math.abs(gs.dy) < 20) || Math.abs(gs.dy) > 30;
      },
      onPanResponderGrant: () => {
        // 可中断：抓住当前呈现值接管进行中的动画（关闭/入场/分页途中均可抓）
        panY.stopAnimation((v) => { dragStartValue.current = v; });
        pageX.stopAnimation((v) => { pageBase.current = v; });
        gestureBaseDy.current = null;
        dragAxis.current = null;
      },
      onPanResponderMove: (_, gs) => {
        // 首帧判定手势主方向：水平 → 分页；垂直 → 关闭
        if (dragAxis.current === null) {
          dragAxis.current = Math.abs(gs.dx) > Math.abs(gs.dy) ? 'x' : 'y';
        }
        if (dragAxis.current === 'x') {
          // 水平分页：1:1 跟手；两端（0 / -winW）之外给橡皮筋渐进阻力
          const raw = pageBase.current + gs.dx;
          const next = raw > 0
            ? rubberband(raw, winW)
            : (raw < -winW ? -winW - rubberband(-winW - raw, winW) : raw);
          pageX.setValue(next);
        } else {
          // 纵向关闭：1:1 跟手；上滑越界橡皮筋
          if (gestureBaseDy.current === null) gestureBaseDy.current = gs.dy;
          const raw = dragStartValue.current + (gs.dy - gestureBaseDy.current);
          const next = raw > 0 ? raw : rubberband(raw, Dimensions.get('window').height);
          lastY.current = next;
          panY.setValue(next);
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (dragAxis.current === 'x') {
          // 水平松手：动量投影判定切页，spring 物理落位（P1-1，继承松手速度）
          pageX.stopAnimation((v) => {
            const projected = v + projectMomentum(gs.vx * 1000);
            const toLyrics = projected < -winW * 0.3;
            Animated.spring(pageX, {
              toValue: toLyrics ? -winW : 0,
              velocity: gs.vx,
              useNativeDriver: true,
              ...springs.uiDefault,
            }).start();
            if (showLyrics !== toLyrics) setShowLyrics(toLyrics);
          });
          return;
        }
        const vy = gs.vy * 1000; // PanResponder 单位 px/ms → px/s
        // 动量投影判定落点：投影越过屏高 35% 即关
        const projected = lastY.current + projectMomentum(vy);
        if (projected >= Dimensions.get('window').height * DISMISS_PROJECT_RATIO) {
          dismiss(vy);
        } else {
          snapBack(vy);
          // 纵向手势下轻微横向位移：补一次分页切换（避免与回弹打架）
          if (Math.abs(vy) < 150 && lastY.current < 20) {
            if (gs.dx < -50) setShowLyrics(true);
            else if (gs.dx > 50) setShowLyrics(false);
          }
        }
      },
      onPanResponderTerminate: () => snapBack(), // 手势被系统抢走（来电等）→ 回弹兜底不丢面板
    })
  ).current;

  if (!song) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']} {...panResponder.panHandlers}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* 全屏播放器固定渐变背景（方案 C：固定配色、不随封面 → 白封面歌不跳变）。
          深浅主题各一套：暗=冷调蓝灰→近黑（亮字阅读区在底部），浅=冷灰→白（深字阅读区在底部）。
          背景层与 contentWrap 共享下滑/缩放/淡出动画：下拉关闭时随面板一起滑走，露出底层
          tab 页面（iOS 全屏媒体 dismiss 行为）；若固定不动会盖住底层页面。 */}
      <Animated.View style={[styles.bgLayer, { transform: [{ translateY: panY }, { scale }], opacity }]} pointerEvents="none">
        <LinearGradient
          colors={isDark ? playerBackground.dark : playerBackground.light}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View style={[
        styles.contentWrap,
        // 背景恒由 bgLayer（固定暗色渐变）提供，contentWrap 恒透明
        { backgroundColor: 'transparent' },
        { transform: [{ translateY: panY }, { scale }], opacity, paddingBottom: insets.bottom + spacing[6] },
      ]}>
        {/* 自定义顶部栏（与背景一体：透明无毛玻璃，图标亮色；iOS 全屏沉浸，真机反馈） */}
        <View style={styles.customHeader}>
          <ScalePress onPress={() => dismiss()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronDown size={28} color={fg.icon} />
          </ScalePress>
          {/* #186 #9：词/封切换改图标对，当前态 accent 高亮；弱化原单字切换的隐晦 */}
          <View style={styles.toggleGroup}>
            <ScalePress onPress={() => setShowLyrics(true)} style={styles.toggleBtn} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
              <MessageSquareText size={22} color={showLyrics ? colors.accent : fg.icon} />
            </ScalePress>
            <ScalePress onPress={() => setShowLyrics(false)} style={styles.toggleBtn} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
              <Disc3 size={22} color={showLyrics ? fg.icon : colors.accent} />
            </ScalePress>
            {/* 更多操作（真机反馈：竖排三点图标，加歌单/下载收进弹层） */}
            <ScalePress onPress={() => setShowMoreModal(true)} style={styles.toggleBtn} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
              <MoreVertical size={22} color={fg.icon} />
            </ScalePress>
          </View>
        </View>

        {/* 词/封 横向分页（真机反馈 #2）：封面页 + 歌词页并排，pageX 平移切换（苹果式 Tab） */}
        <View style={styles.pagerViewport}>
          <Animated.View style={[styles.pagerTrack, { transform: [{ translateX: pageX }] }]}>
            {/* ── 封面页（回退竖排布局）── */}
            <View style={[styles.pagerPage, { width: winW }]}>
              <View style={styles.turntableWrap}>
                <View style={[styles.plinth, { width: plinthSize(winW, winH), height: plinthSize(winW, winH) }]}>
                  <View style={[styles.platter, { width: plinthSize(winW, winH) - 30, height: plinthSize(winW, winH) - 30 }]} />
                  {coverUrl && !coverFailed ? (
                    <Animated.Image
                      source={{ uri: coverUrl }}
                      style={[styles.cover, { width: plinthSize(winW, winH) - 40, height: plinthSize(winW, winH) - 40, transform: [{ rotate: spin }] }]}
                      onError={handleCoverError}
                    />
                  ) : (
                    <View style={[styles.coverPlaceholder, { width: plinthSize(winW, winH) - 40, height: plinthSize(winW, winH) - 40 }]}>
                      <Music size={64} color={colors.textDisabled} />
                    </View>
                  )}
                  {/* 唱臂（#186 #10：播放落臂/暂停抬臂；高度随唱机缩放） */}
                  <View style={styles.tonearmPivot} />
                  <Animated.View style={[styles.tonearmRod, { height: plinthSize(winW, winH) * 0.66, transform: [{ rotate: armAngle }] }]} />
                </View>
              </View>

              {/* 歌曲信息（真机反馈：歌名/歌手居左；来源徽标 + 收藏按钮在右，右侧不空） */}
              <View style={styles.infoWrap}>
                <View style={styles.infoText}>
                  <Text style={styles.title} numberOfLines={1}>{song.name}</Text>
                  <Text style={styles.artist} numberOfLines={1}>{song.artist}</Text>
                </View>
                {song.sourceType !== 'local' && (
                  <View style={styles.sourceTag}>
                    <Text style={styles.sourceTagText}>{SOURCE_LABELS[song.sourceType] || song.sourceType}</Text>
                  </View>
                )}
                <ScalePress onPress={toggleFavorite} style={styles.infoFav} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  {/* P1-4：收藏切换即时 pop 反馈 */}
                  <Animated.View style={{ transform: [{ scale: favPop }] }}>
                    <Heart size={22} color={isFav ? colors.accent : fg.iconSoft} fill={isFav ? colors.accent : 'none'} />
                  </Animated.View>
                </ScalePress>
              </View>

              {/* 歌词预览：始终占位,加载中显示骨架屏,避免歌词到达时布局跳动 */}
              {lyricLines.length > 0 ? (
                <FlatList
                  ref={flatListRef}
                  data={lyricLines}
                  style={styles.lyricsList}
                  renderItem={({ item, index }) => (
                    <ScalePress
                      key={index}
                      onPress={() => seekTo(item.time)}
                    >
                      {index === currentLineIdx ? (
                        <Animated.Text
                          style={[
                            styles.lyricLine,
                            styles.lyricLineActive,
                            {
                              color: lyricPop.interpolate({ inputRange: [0, 1], outputRange: [fg.tertiary, colors.accent] }),
                              transform: [{ scale: lyricPop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
                            },
                          ]}
                        >
                          {item.text}
                        </Animated.Text>
                      ) : (
                        <Text style={styles.lyricLine}>{item.text}</Text>
                      )}
                    </ScalePress>
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
              ) : (
                /* issue #246：空歌词渲染占位行保持歌词区高度，避免普通视图塌缩（P1-5 加图标+方向文案） */
                <View style={styles.lyricsList}>
                  <View style={styles.lyricsEmpty}>
                    <Music size={22} color={colors.textDisabled} />
                    <Text style={styles.lyricsEmptyText}>这首歌暂无歌词</Text>
                  </View>
                </View>
              )}

            {/* 进度条（#186 #4：宽度走共享 sliderWidth） */}
            <View style={styles.progressWrap}>
              <Slider
                style={{ width: sliderWidth(winW) }}
                minimumValue={0}
                maximumValue={Math.max(duration, 1)}
                value={currentTime}
                onSlidingComplete={seekTo}
                minimumTrackTintColor={colors.accent}
                maximumTrackTintColor={colors.borderDefault}
                thumbTintColor={colors.accent}
              />
              <View style={[styles.timeRow, { width: sliderWidth(winW) }]}>
                <Text style={styles.time}>{formatTime(currentTime)}</Text>
                <Text style={styles.time}>{formatTime(duration)}</Text>
              </View>
            </View>

            {/* 控制按钮（真机反馈：循环模式最左、队列最右，与播放三键构成五件布局；
                原底部操作行合并至此，腾出空间给唱盘） */}
            <View style={styles.controls}>
              <ScalePress onPress={cyclePlayMode} style={styles.actionBtn} hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}>
                {/* P1-4：循环模式切换即时 pop 反馈 */}
                <Animated.View style={{ transform: [{ scale: modePop }] }}>
                  <ModeIcon size={24} color={colors.accent} />
                </Animated.View>
              </ScalePress>
              <ScalePress onPress={handlePrev} hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}>
                <SkipBack size={26} color={fg.icon} />
              </ScalePress>
              <ScalePress onPress={() => { tapLight(); togglePlay(); }} style={styles.playBtn} pressScaleTo={0.95}>
                {isPlaying ? (
                  <CirclePause size={56} color={colors.accent} />
                ) : (
                  <CirclePlay size={56} color={colors.accent} />
                )}
              </ScalePress>
              <ScalePress onPress={handleNext} hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}>
                <SkipForward size={26} color={fg.icon} />
              </ScalePress>
              <ScalePress onPress={() => setShowQueueModal(true)} style={styles.actionBtn} hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}>
                <ListMusic size={24} color={fg.icon} />
              </ScalePress>
            </View>
            </View>

            {/* ── 歌词页（纯沉浸）── */}
            <View style={[styles.pagerPage, { width: winW }]}>
              <View style={styles.lyricsFullWrap}>
                {/* 歌词页顶部信息行（利用顶部空间） */}
                <View style={styles.lyricsFullInfo}>
                  <Text style={styles.lyricsFullTitle} numberOfLines={1}>{song.name}</Text>
                  <Text style={styles.lyricsFullArtist} numberOfLines={1}>{song.artist}</Text>
                </View>
                {lyricLines.length > 0 ? (
                  <FlatList
                    ref={lyricsFlatListRef}
                    data={lyricLines}
                    style={styles.lyricsFullList}
                    contentContainerStyle={styles.lyricsFullContent}
                    renderItem={({ item, index }) => (
                      <ScalePress
                        key={index}
                        onPress={() => seekTo(item.time)}
                        style={{ paddingVertical: spacing[1] }}
                      >
                        {index === currentLineIdx ? (
                          <Animated.Text
                                                   style={[
                              styles.lyricsFullLine,
                              styles.lyricsFullLineActive,
                              {
                                color: lyricPop.interpolate({ inputRange: [0, 1], outputRange: [fg.lyricFull, colors.accent] }),
                                transform: [{ scale: lyricPop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }],
                              },
                            ]}
                          >
                            {item.text}
                          </Animated.Text>
                        ) : (
                          <Text style={styles.lyricsFullLine}>{item.text}</Text>
                        )}
                      </ScalePress>
                    )}
                    showsVerticalScrollIndicator={false}
                  />
                ) : (
                  /* P1-5：歌词页空态（图标 + 方向文案） */
                  <View style={styles.lyricsFullEmpty}>
                    <MicVocal size={24} color={colors.textDisabled} />
                    <Text style={styles.lyricsEmptyText}>这首歌暂无歌词</Text>
                  </View>
                )}
              </View>
            </View>
          </Animated.View>
        </View>
      </Animated.View>

      <AddToPlaylistModal
        visible={showPlaylistModal}
        song={song}
        onClose={() => setShowPlaylistModal(false)}
      />
      <QueueListModal
        visible={showQueueModal}
        onClose={() => setShowQueueModal(false)}
      />
      {/* 「更多」弹层（真机反馈：模式/加歌单/下载收纳于此，底部仅留常用键） */}
      <BottomSheet visible={showMoreModal} onClose={() => setShowMoreModal(false)}>
        <View style={styles.moreHeader}>
          <Text style={styles.moreTitle}>更多</Text>
          <ScalePress onPress={() => setShowMoreModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={22} color={colors.textSecondary} />
          </ScalePress>
        </View>
        <ScalePress style={styles.moreItem} onPress={() => { setShowPlaylistModal(true); setShowMoreModal(false); }}>
          <CirclePlus size={20} color={colors.textSecondary} />
          <Text style={styles.moreItemText}>添加到歌单</Text>
        </ScalePress>
        <ScalePress style={styles.moreItem} onPress={() => { handleDownload(); setShowMoreModal(false); }}>
          <Download size={20} color={colors.textSecondary} />
          <Text style={styles.moreItemText}>下载</Text>
        </ScalePress>
      </BottomSheet>
    </SafeAreaView>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 播放器前景色：从 tokens 单一来源（playerForeground）取，随背景明暗切换 */
type PlayerFg = (typeof playerForeground)['dark'] | (typeof playerForeground)['light'];
const makeFg = (isDark: boolean): PlayerFg => (isDark ? playerForeground.dark : playerForeground.light);

const makeStyles = (colors: ThemeColors, fg: PlayerFg) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', alignItems: 'center' },
  // 全屏背景层（绝对铺满，位于 Animated contentWrap 之下）：固定暗色渐变，恒渲染
  bgLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // contentWrap 恒透明（背景交给 bgLayer）；是 Animated.View（native driver），背景层独立在其下
  contentWrap: { flex: 1, alignItems: 'center', backgroundColor: 'transparent', width: '100%' },
  customHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: spacing[4],
    height: 44,
  },
  // 词/封横向分页（真机反馈 #2）：viewport 裁剪 + track 双页平移
  pagerViewport: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  // 注意：track 不能 flex:1（row 方向会约束宽度为屏宽、把两页压扁到半屏），
  // 宽度由两个 winW 的 pagerPage 撑开为 2 倍屏宽，高度继承 viewport
  pagerTrack: {
    height: '100%',
    flexDirection: 'row',
  },
  // 注意：pagerPage 绝不能 flex:1（row 里会 grow 把固定宽度压缩回半屏，又变成分栏！）
  // 宽度由 JSX 注入 winW 固定，高度 100% 填满 track
  pagerPage: {
    height: '100%',
    alignItems: 'center',
  },
  // 唱机底座（回退竖排布局）
  turntableWrap: {
    marginTop: spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 唱机底座（#186 #4：尺寸由 JSX 按屏宽注入，此处只留形态）
  plinth: {
    borderRadius: radius.xl,
    backgroundColor: turntable.plinth,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.lg,
    borderWidth: 1,
    borderColor: turntable.platterBorder,
  },
  platter: {
    position: 'absolute',
    borderRadius: radius.full,
    backgroundColor: turntable.platter,
    borderWidth: 1,
    borderColor: turntable.platterBorder,
  },
  cover: {
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: turntable.coverBorder,
  },
  coverPlaceholder: {
    borderRadius: radius.full,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 唱臂
  tonearmPivot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: turntable.tonearmPivot,
    borderWidth: 2,
    borderColor: turntable.tonearmPivotBorder,
    zIndex: 10,
  },
  tonearmRod: {
    position: 'absolute',
    top: 12,
    right: 10,
    width: 4,
    height: 183,
    backgroundColor: turntable.tonearm,
    borderRadius: radius.xs,
    transformOrigin: 'top',
    zIndex: 9,
  },
  // 「更多」弹层（真机反馈：模式/加歌单/下载收纳）
  moreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
  moreTitle: { ...textVariants.title, color: colors.textPrimary },
  moreItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
  },
  moreItemText: { ...textVariants.body, color: colors.textPrimary, marginLeft: spacing[3] },
  // 词/封切换图标对（#186 #9）
  toggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  toggleBtn: {
    padding: spacing[1],
  },
  // 歌曲信息（真机反馈：歌名/歌手居左，收藏按钮独立在右）
  infoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[3],
    paddingHorizontal: spacing[6],
  },
  infoText: { flex: 1, alignItems: 'flex-start' },
  // 前景色随背景明暗切换（fg）：暗背景→亮字 / 浅背景→深字
  title: { ...textVariants.titleLg, color: fg.primary },
  artist: { ...textVariants.footnote, color: fg.secondary, marginTop: 4 },
  // 来源徽标移到收藏按钮左侧（真机反馈：右侧不空）
  infoFav: { marginLeft: spacing[2], padding: spacing[1] },
  sourceTag: {
    marginLeft: spacing[2],
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: fg.badgeBg,
  },
  sourceTagText: { ...textVariants.micro, color: fg.badgeText },
  progressWrap: { marginTop: spacing[3], alignItems: 'center' },
  // 宽度由 JSX 注入 sliderWidth(winW)（#186 #4 旋转/折叠屏实时）
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  time: { ...textVariants.caption, color: fg.tertiary, fontVariant: ['tabular-nums'] },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[3],
    gap: spacing[6], // 真机反馈：原 gap 40pt 过宽，收窄让播放键紧凑
  },
  playBtn: { marginHorizontal: spacing[2] },
  // #186 #3：icon 24 + padding 14 ≈ 52pt 触控区，达 44pt 下限
  actionBtn: { padding: spacing[2], margin: 6 },
  // 歌词预览（真机反馈：字号调小后 minHeight 降到三行高度 ~76，issue #246 防塌缩）
  lyricsList: {
    flex: 1,
    minHeight: 76,
    marginTop: spacing[3],
    marginHorizontal: spacing[6],
  },
  // 真机反馈：普通视图歌词——灰行小、蓝行明显大一号、行距收紧。
  // P1-3：行高固定（避免 scrollToIndex 抖动），active 行用 scale+颜色过渡（见 renderItem），不再跳字号
  lyricLine: { color: fg.tertiary, fontSize: 13, textAlign: 'center', marginVertical: 4, lineHeight: 18 },
  lyricLineActive: { fontWeight: '600' },
  // 歌词骨架屏：行高/间距与 lyricLine 一致,占位稳定避免加载后跳动
  skeletonLine: {
    alignSelf: 'center',
    height: 15,
    borderRadius: radius.full,
    backgroundColor: fg.skeleton,
    marginVertical: 6,
  },
  // 真机反馈：歌词页歌词——灰行小、蓝行明显大、行距收紧。P1-3：行高固定，active 用 scale 过渡
  lyricsFullLine: { color: fg.lyricFull, fontSize: 16, textAlign: 'center', marginVertical: 6, lineHeight: 24 },
  lyricsFullLineActive: { fontWeight: '600' },
  // P1-5：空歌词占位（图标 + 方向文案）
  lyricsEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing[4],
    gap: spacing[2],
  },
  lyricsEmptyText: { ...textVariants.footnote, color: fg.tertiary },
  lyricsFullEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  lyricsFullWrap: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    width: '100%',
  },
  // 全屏歌词页顶部信息行（真机反馈重排：利用顶部空间）
  lyricsFullInfo: {
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  lyricsFullTitle: { ...textVariants.titleLg, color: fg.primary },
  lyricsFullArtist: { ...textVariants.subhead, color: fg.secondary, marginTop: 2 },
  lyricsFullList: {
    flex: 1,
    width: '100%',
  },
  lyricsFullContent: {
    paddingVertical: spacing[5],
  },
});
