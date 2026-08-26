import { useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView,
  PanResponder, Animated, Alert, Dimensions, useWindowDimensions, Easing,
} from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent, StyleProp, TextStyle, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
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

/** 唱盘尺寸（#186 #4 + 真机反馈 + 布局优化）：底部操作行合并进控制行后省出空间，
 *  按屏宽 72% / 屏高 36% 缩放（收一档四周留白对称，配合唱盘弹性居中悬浮感；
 *  SE 667dp → ~230，常见 731dp → ~259，上限 280） */
function plinthSize(width: number, winH: number): number {
  return Math.max(200, Math.min(width * 0.72, winH * 0.4, 280));
}
/** 进度条/时间行宽度：唱盘同轴的 `屏宽 - 48`，统一此处防散落魔数（#186 #4） */
function sliderWidth(width: number): number {
  return width - 48;
}
/** 歌词预览单行高 = lyricLine（lineHeight 18 + marginVertical 4×2）；改行样式须同步此值 */
const LYRICS_PREVIEW_LINE_H = 26;
/** 封面页歌词预览固定三行（真机反馈：预览区误触滚动 → 禁滚 + 固定三行） */
const LYRICS_PREVIEW_HEIGHT = LYRICS_PREVIEW_LINE_H * 3;
/** 全屏歌词页单行高 = lyricsFullLine（lineHeight 24 + marginVertical 6×2）+ ScalePress paddingVertical 4×2 */
const LYRICS_FULL_LINE_H = 44;

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
  // 注意：currentTime/duration 故意不在根组件订阅（每 250ms 心跳会重渲染整棵树，
  // JS 线程塞满后点暂停都排队）——订阅下沉到 ProgressBlock / LyricSyncer 叶子组件
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
  // 最新值 ref：PanResponder release 闭包可能拿到 stale state（连续快滑时组件未重渲染），
  // 判定要用实时 ref 而非闭包值（否则页面切回但图标状态不同步）
  const showLyricsRef = useRef(showLyrics);
  showLyricsRef.current = showLyrics;
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

  // 词/封横向分页（真机反馈 #2）：不再自造 PanResponder 平移（Fabric 下框架 gestureState
  // 被清零/晚到，引发「切不回」「整屏闪」一系列问题），改用核心组件原生分页——
  // horizontal + pagingEnabled 的吸附/速度物理全在原生侧，JS 只做图标状态同步。
  const pagerRef = useRef<ScrollView>(null);
  // 分页拖动期间暂停歌词自动滚动（scrollToIndex 动画与跟手渲染抢 JS 线程）
  const isPagingRef = useRef(false);
  /** 图标切页：scrollTo 走原生分页动画；减弱动效直接跳页 */
  const animateToPage = (toLyrics: boolean) => {
    setShowLyrics(toLyrics);
    pagerRef.current?.scrollTo({ x: toLyrics ? winW : 0, animated: !reducedMotion });
  };
  // 滚动同步高亮：过半即翻面（与原生吸附判定一致）；setShowLyrics 同值由 React bail out
  const handlePagerScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const toLyrics = Math.round(e.nativeEvent.contentOffset.x / winW) >= 1;
    if (toLyrics !== showLyricsRef.current) setShowLyrics(toLyrics);
  };

  // 封面匀速旋转（native driver，修复 JS rAF 卡顿）：角度累积（每圈 +360，永不归零），
  // 暂停 stopAnimation 冻结当前值、续播从「当前值 +360」续转（不跳变）。
  // rotate 大角度视觉周期无缝（360≡0），interpolate 用 extrapolate extend 线性外推。
  const ROTATE_MS = 12000; // 一圈 12s，速度与唱盘旋转观感一致
  useEffect(() => {
    if (!isPlaying || reducedMotion) {
      rotation.stopAnimation();
      return;
    }
    let disposed = false;
    // 续播起点 = 暂停时的当前角度（stopAnimation 会把 native 值同步回 JS，直接续转无跳变）
    let target = (rotation as unknown as { __getValue(): number }).__getValue() + 360;
    const spinOnce = () => {
      if (disposed) return;
      Animated.timing(rotation, {
        toValue: target,
        duration: ROTATE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }).start(({ finished }) => {
        if (finished) {
          target += 360;
          spinOnce();
        }
      });
    };
    spinOnce();
    return () => {
      disposed = true;
      rotation.stopAnimation();
    };
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
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
    // 累积大角度（每圈 +360）线性外推：rotate 360n° 视觉周期无缝
    extrapolate: 'extend',
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

  // 歌词高亮同步：下沉到 LyricSyncer 叶子组件（订阅 currentTime 的地方尽量小——
  // 每 250ms 心跳只重渲染 syncer 自己，不再打整棵全屏播放器树）

  // P1-3：歌词行激活动画——改为每行独立动画（LyricRow 组件）：
  // 共享单值方案在行切换时会「旧行瞬间回落 + 新行 setValue(0) 硬重置后再弹起」
  // = 真机可见的跳变两次；说唱快切时反复 stop/重播 = 闪烁。
  // LyricRow 各行持有自己的 Animated.Value，isActive 双向 spring（激活弹起 /
  // 离场平滑回落），行间互不干扰，快切天然平滑。

  const toggleFavorite = () => {
    if (!song) return;
    popValue(favPop);
    if (isFav) removeFavorite(song.id);
    else addFavorite(song);
  };

  /** 点击歌词行 seek：乐观同步 store.currentTime——否则高亮要等下一次
   *  playbackStatusUpdate（updateInterval 250ms）才切换，真机上表现为
   *  「点了没反应/激活慢半拍」；暂停态下点击 → 从该行恢复播放 */
  const seekToPreviewLine = (timeSec: number) => {
    usePlayerStore.getState().setCurrentTime(timeSec);
    void seekTo(timeSec);
    if (!isPlaying) void togglePlay();
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

  // ── 手势物理（ADR-0004）：可中断、速度继承、动量投影、橡皮筋。
  //    只管竖直下拉关闭；横向分页已交给原生 ScrollView，外层永不认领横向手势。──
  const dragStartValue = useRef(0);                 // 抓取瞬间面板呈现值（支持中途抓住动画）
  const gestureBaseDy = useRef<number | null>(null); // 首个 move 事件校准基准（消除激活前位移跳变）
  const lastY = useRef(0);                          // 最近一帧面板位置（release 同步可读）
  // 真机实测（PKB110/Fabric）：release 回调拿到的框架 gestureState 可能已被下一个
  // 触摸序列清零（vy=0），松手判定用 move 阶段自采样：对呈现位置差分 + EMA 平滑。
  const vySampleRef = useRef({ vy: 0, lastY: 0, t: -1 });
  // stopAnimation 的 getValue 走原生异步回路，回调可能晚于首个 move 到达；
  // 基准未就绪前丢弃 move 帧，防止跟手从错误基准起跳。
  const dragBaseReadyRef = useRef(false);

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
      // 只认领竖直下拉（dy 严格占优防斜滑误判）：横向让给原生分页 ScrollView，
      // 竖向在歌词列表上让给列表自身滚动（bubble 协商子组件优先）
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 24 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderGrant: () => {
        // 可中断：抓住当前呈现值接管进行中的动画（关闭/入场途中均可抓）
        panY.stopAnimation((v) => { dragStartValue.current = v; dragBaseReadyRef.current = true; });
        gestureBaseDy.current = null;
        vySampleRef.current = { vy: 0, lastY: 0, t: -1 };
        isPagingRef.current = true;
      },
      onPanResponderMove: (e, gs) => {
        if (!dragBaseReadyRef.current) return; // 基准未就绪：丢弃头部帧防错跳
        const ts = e.nativeEvent.timestamp;
        const s = vySampleRef.current;
        // 首个 move 校准原点：grant 前的累计位移不参与跟手（防瞬移）
        if (gestureBaseDy.current === null) {
          gestureBaseDy.current = gs.dy;
          s.lastY = dragStartValue.current;
        }
        // 竖直下拉 1:1 跟手；上滑越界橡皮筋
        const raw = dragStartValue.current + (gs.dy - gestureBaseDy.current);
        const next = raw > 0 ? raw : rubberband(raw, Dimensions.get('window').height);
        // 自采样速度（dt<4ms 视为时间戳抖动丢弃；瞬时钳 ±4000 防弹簧带天文速度瞬扫整屏）
        const dt = ts - s.t;
        if (s.t >= 0 && dt >= 4 && dt < 100) {
          const ivy = Math.max(-4000, Math.min(4000, ((next - s.lastY) / dt) * 1000));
          s.vy = s.vy === 0 ? ivy : s.vy * 0.6 + ivy * 0.4;
        }
        s.lastY = next;
        s.t = ts;
        lastY.current = next;
        panY.setValue(next);
      },
      onPanResponderRelease: () => {
        const vy = Math.max(-3000, Math.min(3000, vySampleRef.current.vy)); // px/s 自采样 + 钳幅
        // 动量投影判定落点：投影越过屏高 35% 即关（快甩任意位置能关，慢拖半途自然回弹）
        const projected = lastY.current + projectMomentum(vy);
        if (projected >= Dimensions.get('window').height * DISMISS_PROJECT_RATIO) {
          dismiss(vy);
        } else {
          snapBack(vy);
        }
        setTimeout(() => { isPagingRef.current = false; }, 400);
      },
      onPanResponderTerminate: () => snapBack(), // 手势被系统抢走（来电等）→ 回弹兜底不丢面板
    })
  ).current;

  if (!song) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']} {...panResponder.panHandlers}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* 歌词高亮同步器（渲染 null）：currentTime 订阅下沉点，心跳不打全树 */}
      <LyricSyncer
        lyricLines={lyricLines}
        currentLineIdx={currentLineIdx}
        setCurrentLineIdx={setCurrentLineIdx}
        flatListRef={flatListRef}
        lyricsFlatListRef={lyricsFlatListRef}
        isPagingRef={isPagingRef}
      />

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
          {/* #186 #9：词/封切换改图标对，当前态 accent 高亮；唱片视图在左、歌词视图在右
              （真机反馈：与「封面页在左 / 歌词页在右」的页面顺序对位） */}
          <View style={styles.toggleGroup}>
            <ScalePress onPress={() => { setShowLyrics(false); animateToPage(false); }} style={styles.toggleBtn} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
              <Disc3 size={22} color={showLyrics ? fg.icon : colors.accent} />
            </ScalePress>
            <ScalePress onPress={() => { setShowLyrics(true); animateToPage(true); }} style={styles.toggleBtn} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
              <MessageSquareText size={22} color={showLyrics ? colors.accent : fg.icon} />
            </ScalePress>
            {/* 更多操作（真机反馈：竖排三点图标，加歌单/下载收进弹层） */}
            <ScalePress onPress={() => setShowMoreModal(true)} style={styles.toggleBtn} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
              <MoreVertical size={22} color={fg.icon} />
            </ScalePress>
          </View>
        </View>

        {/* 词/封 横向分页（真机反馈 #2）：原生分页 ScrollView——吸附/速度物理全在原生侧，
            图标切换走 scrollTo、页码同步走 onScroll；外层手势只管竖直下拉关闭 */}
        <ScrollView
          ref={pagerRef}
          style={styles.pager}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={handlePagerScroll}
          onScrollBeginDrag={() => { isPagingRef.current = true; }}
          onScrollEndDrag={() => { isPagingRef.current = false; }}
          onMomentumScrollEnd={() => { isPagingRef.current = false; }}
        >
          {/* ── 封面页（回退竖排布局）── */}
          <View style={[styles.pagerPage, { width: winW }]}>
              {/* 唱盘区：弹性居中——唱盘在「顶栏与信息区」之间悬浮，
                  信息/歌词/进度/控制沉底（Apple Music 全屏媒体三层结构） */}
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

              {/* 歌词预览（真机反馈）：固定三行、禁手指滚动——只保留自动跟随；
                  scrollEnabled=false 不影响编程 scrollToIndex，但必须配 getItemLayout
                  （小窗口下目标行未测量时 scrollToIndex 会静默失败）；
                  渐隐用 MaskedView + 渐变 alpha mask（Apple Music 预览形态）——对内容
                  做遮罩而非盖色带：边缘真正淡出、透出实际背景，任何底色无接缝。
                  （调研结论：overlay LinearGradient 用背景中间色会与垂直渐变露缝，
                  且 transparent=transparent black 在浅色下呈脏带，弃用） */}
              <MaskedView
                style={styles.lyricsPreviewWrap}
                maskElement={
                  <LinearGradient
                    /* alpha 遮罩：MaskedView 只取 alpha 通道，颜色用命名色（design-lint 纪律） */
                    colors={['transparent', 'black', 'black', 'transparent']}
                    locations={[0, 0.06, 0.94, 1]}
                    style={StyleSheet.absoluteFill}
                  />
                }
              >
                {lyricLines.length > 0 ? (
                  <FlatList
                    ref={flatListRef}
                    data={lyricLines}
                    style={styles.lyricsList}
                    scrollEnabled={false}
                    getItemLayout={(_, index) => ({
                      length: LYRICS_PREVIEW_LINE_H,
                      offset: LYRICS_PREVIEW_LINE_H * index,
                      index,
                    })}
                    renderItem={({ item, index }) => (
                      <LyricRow
                        text={item.text}
                        isActive={index === currentLineIdx}
                        numberOfLines={1}
                        baseStyle={styles.lyricLine}
                        activeStyle={styles.lyricLineActive}
                        dimColor={fg.tertiary}
                        activeColor={colors.accent}
                        scaleTo={1} /* 预览区不缩放：transform 不改布局宽，长行放大两端会出界被裁 */
                        onPress={() => seekToPreviewLine(item.time)}
                      />
                    )}
                    showsVerticalScrollIndicator={false}
                  />
                ) : lyricsLoading ? (
                  <View style={styles.lyricsList}>
                    {[0, 1, 2].map((i) => (
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
              </MaskedView>

            {/* 进度条 + 时间行：叶子组件自订阅 currentTime（250ms 心跳不打全树） */}
            <ProgressBlock styles={styles} colors={colors} fg={fg} winW={winW} />

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
                    /* 行高固定 44（lineHeight 24 + marginVertical 12 + paddingVertical 8）；
                       说唱长歌词无 getItemLayout 时 scrollToIndex 目标未测量会静默失败
                       （onScrollToIndexFailed 被 try/catch 吞）→ 自动跟随失灵。
                       offset 需计入 contentContainer 的 paddingVertical(spacing[5]=20) */
                    getItemLayout={(_, index) => ({
                      length: LYRICS_FULL_LINE_H,
                      offset: spacing[5] + LYRICS_FULL_LINE_H * index,
                      index,
                    })}
                    renderItem={({ item, index }) => (
                      <LyricRow
                        text={item.text}
                        isActive={index === currentLineIdx}
                        baseStyle={styles.lyricsFullLine}
                        activeStyle={styles.lyricsFullLineActive}
                        dimColor={fg.lyricFull}
                        activeColor={colors.accent}
                        scaleTo={1.1}
                        onPress={() => seekToPreviewLine(item.time)}
                        onPressStyle={{ paddingVertical: spacing[1] }}
                      />
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
        </ScrollView>
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

/**
 * 歌词高亮同步器（无渲染）：唯一订阅 currentTime 的歌词侧组件。
 * 真机定位：根组件订阅 currentTime 时，250ms 播放心跳每 tick 重渲染整棵
 * 全屏播放器树，JS 线程被塞满——说唱快切时点暂停都要排队（暂停延迟 bug）。
 * 下沉后心跳只重渲染本组件（渲染 null，近零成本），根组件只在真正换行时更新。
 */
const LyricSyncer = memo(function LyricSyncer({
  lyricLines, currentLineIdx, setCurrentLineIdx, flatListRef, lyricsFlatListRef, isPagingRef,
}: {
  lyricLines: LyricLine[];
  currentLineIdx: number;
  setCurrentLineIdx: (idx: number) => void;
  flatListRef: React.RefObject<FlatList<LyricLine> | null>;
  lyricsFlatListRef: React.RefObject<FlatList<LyricLine> | null>;
  isPagingRef: React.RefObject<boolean>;
}) {
  const currentTime = usePlayerStore(s => s.currentTime);
  useEffect(() => {
    if (lyricLines.length === 0) {
      if (currentLineIdx !== -1) setCurrentLineIdx(-1);
      return;
    }
    const idx = findCurrentLyricIndex(lyricLines, currentTime);
    if (isPagingRef.current) return; // pager 手势/动画中暂停自动滚动，避免与手势跟手抢 JS 线程
    if (idx !== currentLineIdx) {
      setCurrentLineIdx(idx);
      if (idx >= 0) {
        // 快切 guard（说唱调研）：相邻行 → 动画滚动；跳行（seek/切歌）→ 直接跳位。
        // animated 连续滚动互相打断是说唱「行切换乱跳」的一半来源
        const jump = currentLineIdx >= 0 ? Math.abs(idx - currentLineIdx) : 99;
        const animated = jump <= 1;
        try { flatListRef.current?.scrollToIndex({ index: idx, animated, viewPosition: 0.5 }); } catch {}
        try { lyricsFlatListRef.current?.scrollToIndex({ index: idx, animated, viewPosition: 0.5 }); } catch {}
      }
    }
  }, [currentTime, lyricLines, currentLineIdx, setCurrentLineIdx, flatListRef, lyricsFlatListRef, isPagingRef]);
  return null;
});

/**
 * 进度条 + 时间行（自订阅 currentTime/duration 的叶子组件）：
 * 250ms 心跳只重渲染这块小子树，进度/时间照常实时，全屏播放器其余部分不动。
 */
const ProgressBlock = memo(function ProgressBlock({
  styles, colors, fg, winW,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  fg: PlayerFg;
  winW: number;
}) {
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  return (
    <View style={styles.progressWrap}>
      <Slider
        style={{ width: sliderWidth(winW) }}
        minimumValue={0}
        maximumValue={Math.max(duration, 1)}
        value={currentTime}
        onSlidingComplete={(t) => {
          // 拖动 seek 同样乐观同步：松手高亮/时间立即跟手，不等 250ms 心跳
          usePlayerStore.getState().setCurrentTime(t);
          void seekTo(t);
        }}
        minimumTrackTintColor={colors.accent}
        /* 轨道色用 fg.tertiary：浅色下 borderDefault(gray200) 与背景几乎同色不可见
           （真机反馈）；fg.tertiary 随播放器前景明暗切换，两套主题都可见 */
        maximumTrackTintColor={fg.tertiary}
        thumbTintColor={colors.accent}
      />
      <View style={[styles.timeRow, { width: sliderWidth(winW) }]}>
        <Text style={styles.time}>{formatTime(currentTime)}</Text>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
});

interface LyricRowProps {
  text: string;
  isActive: boolean;
  /** 预览区单行截断；全屏页不传（长行允许换行） */
  numberOfLines?: number;
  baseStyle: StyleProp<TextStyle>;
  activeStyle: StyleProp<TextStyle>;
  dimColor: string;
  activeColor: string;
  scaleTo: number;
  onPress: () => void;
  onPressStyle?: StyleProp<ViewStyle>;
}

/**
 * 歌词行（每行独立动画，调研结论 = 社区标准模式）：
 * - 每行持有自己的常驻 Animated.Value，isActive 只改「目标」：激活 0→1 弹起、
 *   离场 1→0 平滑回落，弹簧从当前值继续（AMLL spring 同款语义）→ 行间互不
 *   干扰，说唱快切无共享值重置跳变
 * - 挂载即落位：惰性初始化直接取当前状态（虚拟化重挂/切歌定位不播动画不闪跳）
 * - 减弱动效：直接落值不做弹簧（§14 前庭安全）
 */
const LyricRow = memo(function LyricRow({
  text, isActive, numberOfLines, baseStyle, activeStyle, dimColor, activeColor, scaleTo, onPress, onPressStyle,
}: LyricRowProps) {
  const reducedMotion = useReducedMotion();
  // 惰性初始化：首个渲染即取当前激活状态为静止值（挂载不动画）
  const popRef = useRef<Animated.Value | null>(null);
  if (popRef.current === null) {
    popRef.current = new Animated.Value(isActive ? 1 : 0);
  }
  const pop = popRef.current;

  useEffect(() => {
    if (reducedMotion) {
      pop.setValue(isActive ? 1 : 0);
      return;
    }
    // 快速 timing（150ms）而非 spring：高亮强调要「即点即到」——慢弹簧会让颜色
    // 变化滞后于滚动定位半秒（真机体感），激活感知被拖成两段式
    Animated.timing(pop, {
      toValue: isActive ? 1 : 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    return () => pop.stopAnimation();
  }, [isActive, pop, reducedMotion]);

  return (
    <ScalePress onPress={onPress} style={onPressStyle}>
      <Animated.Text
        numberOfLines={numberOfLines}
        style={[
          baseStyle,
          isActive && activeStyle,
          {
            color: pop.interpolate({ inputRange: [0, 1], outputRange: [dimColor, activeColor] }),
            transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) }],
          },
        ]}
      >
        {text}
      </Animated.Text>
    </ScalePress>
  );
});

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
  // 词/封横向分页（真机反馈 #2）：原生分页 ScrollView，占满顶栏以下空间
  pager: {
    flex: 1,
    width: '100%',
  },
  // 注意：pagerPage 绝不能 flex:1（row 里会 grow 把固定宽度压缩回半屏，又变成分栏！）
  // 宽度由 JSX 注入 winW 固定；高度由横排容器的 alignItems stretch 撑满
  pagerPage: {
    height: '100%',
    alignItems: 'center',
  },
  // 唱盘区（真机反馈 + 布局优化）：弹性占满「顶栏与信息区」之间，唱盘居中悬浮——
  // 页面由「上实下空」变为「唱盘居中、底部三层沉底」，高屏适配自动成立
  turntableWrap: {
    flex: 1,
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
  // 歌曲信息（真机反馈：歌名/歌手居左，收藏按钮独立在右；
  // marginTop 16 与唱盘区分离一档，信息/歌词/进度/控制各自呼吸）
  infoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[4],
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
  progressWrap: { marginTop: spacing[4], alignItems: 'center' },
  // 宽度由 JSX 注入 sliderWidth(winW)（#186 #4 旋转/折叠屏实时）
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  time: { ...textVariants.caption, color: fg.tertiary, fontVariant: ['tabular-nums'] },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[4], // 与进度区分离一档（E）
    gap: spacing[6], // 真机反馈：原 gap 40pt 过宽，收窄让播放键紧凑
  },
  playBtn: { marginHorizontal: spacing[2] },
  // #186 #3：icon 24 + padding 14 ≈ 52pt 触控区，达 44pt 下限
  actionBtn: { padding: spacing[2], margin: 6 },
  // 封面页歌词预览（真机反馈）：固定三行高 + overflow 裁切，scrollEnabled=false 禁手滑；
  // 外边距归 wrapper（lyricsPreviewWrap）管，本样式只留固定高度
  lyricsList: {
    height: LYRICS_PREVIEW_HEIGHT,
    overflow: 'hidden',
  },
  // 歌词预览容器：MaskedView 宿主（alpha 渐变遮罩做上下渐隐），外边距分档（12）
  lyricsPreviewWrap: {
    marginTop: spacing[3],
    marginHorizontal: spacing[6],
    height: LYRICS_PREVIEW_HEIGHT,
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
