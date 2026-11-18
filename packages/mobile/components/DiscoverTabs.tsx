import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Check, ChevronDown, ChevronRight, Disc3, ListMusic, User } from 'lucide-react-native';
import { router } from 'expo-router';
import { getDirectClient, formatPlayCount } from '@mplayer/core';
import type { Album, DiscoverPlaylist, Song, SourceKey } from '@mplayer/core';
import { radius, spacing, textVariants } from '../theme/tokens';
import { lightColors, darkColors } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { useReducedMotion } from '../hooks/useReducedMotion';
import ScalePress, { pressScale } from './ScalePress';
import SourceBadge from './SourceBadge';
import TextTabs from './TextTabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, LIST_TAIL_PADDING } from './chromeMetrics';
import CoverGridSkeleton from './CoverGridSkeleton';
import SkeletonBlock from './SkeletonBlock';
import LazyCover from './LazyCover';
import { listWindowProps } from './listWindow';
import HotlistSkeleton from './HotlistSkeleton';
import { GRID_CARD } from './gridCardMetrics';
import { HOTLIST_SECTION } from './hotlistMetrics';
import { SONG_ROW } from './songRowMetrics';
import LoadMoreFooter from './LoadMoreFooter';
import BottomSheet from './BottomSheet';
import DiscoverHero from './DiscoverHero';
import ChartRow from './DiscoverChartRow';
import DiscoverStateView from './DiscoverStateView';
import InlineError from './InlineError';
import {
  useDiscoverStore,
  buildHotlistQueue,
  hotlistItemToSong,
  DISCOVER_CHART_ROWS,
  DISCOVER_SOURCES,
  DISCOVER_TABS,
} from '../stores/discoverStore';
import type { DiscoverSource, DiscoverTab, HotlistItem } from '../stores/discoverStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong as playAudio } from '../services/audioPlayer';
import { searchStrictMatch } from '../services/songResources';
import { gridCardWidth, GRID_GAP } from './gridMetrics';

const CHART_SOURCE_LABELS: Record<DiscoverSource, string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
};

/* ===== 新碟 ===== */
const ALBUM_AREAS = [
  { label: '全部', value: 'ALL' },
  { label: '华语', value: 'ZH' },
  { label: '欧美', value: 'EA' },
  { label: '韩国', value: 'KR' },
  { label: '日本', value: 'JP' },
];
const ALBUM_COLS = 3;
const ALBUM_INITIAL_ROWS = 3;
const ALBUM_INITIAL_COUNT = ALBUM_COLS * ALBUM_INITIAL_ROWS;
/** 编辑推荐卡的封面边长（布局尺寸，非颜色/字号/圆角 token 范畴）。 */
const ALBUM_FEATURE_COVER = 68;
const albumCardW = gridCardWidth({ cols: ALBUM_COLS });

/* ===== 歌单 ===== */
const PLAYLIST_COLS = 2;
const playlistCardW = gridCardWidth({ cols: PLAYLIST_COLS });
const PLAYLIST_CATEGORIES = ['全部', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '爵士', '古典', 'R&B', '乡村', '小清新', '影视原声', '动漫', '怀旧', '治愈']
  .map((c) => ({ label: c, value: c }));

/* ===== 歌手 ===== */
const ARTIST_COLS = 3;
const artistCardW = gridCardWidth({ cols: ARTIST_COLS });
const ARTIST_CATEGORIES = [
  { label: '全部', value: '0' },
  { label: '华语男', value: '1001' },
  { label: '华语女', value: '1002' },
  { label: '华语组合', value: '1003' },
  { label: '欧美男', value: '2001' },
  { label: '欧美女', value: '2002' },
  { label: '欧美组合', value: '2003' },
  { label: '日本', value: '6001' },
  { label: '韩国', value: '7001' },
  { label: '其他', value: '4001' },
];

/**
 * 榜单点歌：当前 section 的整组 10 首入队，选中位置回填搜索命中的 url/lrc。
 * 队列语义收口在 store 的 buildHotlistQueue（单测覆盖），此处只负责编排。
 */
async function playChartSong(items: HotlistItem[], index: number, sourceType: SourceKey) {
  const item = items[index];
  if (!item) return;
  let resolved: Song | null = null;
  try {
    // 热榜数据不含 url/lrc：路由搜索（直连 + tier3 兜底）+ 严格匹配，
    // 命中后只回填 url/lrc 再播原 item——不播搜索结果本体（防同名 cover 错播）
    resolved = await searchStrictMatch(hotlistItemToSong(item, sourceType));
  } catch {
    // 搜索失败仍播原条目：后续解析链会继续兜底
  }
  const { queue, song } = buildHotlistQueue(items, index, sourceType, resolved);
  if (!song) return;
  usePlayerStore.getState().setQueue(queue, index);
  playAudio(song);
}

export default function DiscoverTabs() {
  const { colors, isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const tab = useDiscoverStore((s) => s.tab);
  const setTab = useDiscoverStore((s) => s.setTab);
  const source = useDiscoverStore((s) => s.source);
  const setSource = useDiscoverStore((s) => s.setSource);
  const [sourceSheet, setSourceSheet] = useState(false);

  const fade = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);

  // tab 切换：200ms 淡入 + 8px 上移；减弱动效退化为纯淡入。只动 opacity/transform。
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    fade.stopAnimation();
    lift.stopAnimation();
    if (reducedMotion) lift.setValue(0);
    const fadeIn = Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true });
    const anim = reducedMotion
      ? fadeIn
      : Animated.parallel([
        fadeIn,
        Animated.timing(lift, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]);
    anim.start();
    return () => anim.stop();
  }, [tab, reducedMotion, fade, lift]);

  const selectTab = (key: string) => {
    const next = key as DiscoverTab;
    if (next === tab) return;
    // 先归零再切内容：避免新内容在第一帧以完整不透明度闪一下
    fade.setValue(0);
    lift.setValue(reducedMotion ? 0 : 8);
    setTab(next);
  };

  const sourceLabel = DISCOVER_SOURCES.find((s) => s.key === source)?.label ?? '网易云';

  return (
    <View style={[styles.container, { paddingTop: topChromeHeight(insets.top) }]}>
      {/* 视觉隐藏的页名：内容区不再重复可见大标题，读屏仍能识别当前页面 */}
      <Text style={styles.srHeading} accessibilityRole="header">发现</Text>

      <View style={styles.header}>
        <View style={styles.headerTabs}>
          <TextTabs tabs={DISCOVER_TABS} activeKey={tab} onSelect={selectTab} />
        </View>
        {tab === 'hotlist' && (
          <Pressable
            style={styles.sourceChip}
            onPress={() => setSourceSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={`榜单来源：${sourceLabel}`}
            accessibilityHint="打开来源选择"
            hitSlop={8}
          >
            <SourceBadge source={source} size="sm" />
            <Text style={styles.sourceChipText}>{sourceLabel}</Text>
            <ChevronDown size={14} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <Animated.View style={[styles.content, { opacity: fade, transform: [{ translateY: lift }] }]}>
        {tab === 'hotlist' && <HotlistContent />}
        {tab === 'albums' && <AlbumsContent />}
        {tab === 'playlists' && <PlaylistContent />}
        {tab === 'artists' && <ArtistContent />}
      </Animated.View>

      <BottomSheet visible={sourceSheet} onClose={() => setSourceSheet(false)}>
        <Text style={styles.sheetTitle}>榜单来源</Text>
        <Text style={styles.sheetSub}>仅影响发现页排行榜，不改变搜索来源</Text>
        {DISCOVER_SOURCES.map((option) => {
          const selected = option.key === source;
          return (
            <Pressable
              key={option.key}
              style={({ pressed }) => [styles.sourceOption, pressed && styles.sourceOptionPressed]}
              onPress={() => {
                setSource(option.key);
                setSourceSheet(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
            >
              <SourceBadge source={option.key} size="md" />
              <Text style={styles.sourceOptionText}>{option.label}</Text>
              {selected && <Check size={20} color={colors.accent} />}
            </Pressable>
          );
        })}
      </BottomSheet>
    </View>
  );
}

/* ===== 排行榜 ===== */
function HotlistContent() {
  const { isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const insets = useSafeAreaInsets();
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const source = useDiscoverStore((s) => s.source);
  const chart = useDiscoverStore((s) => s.charts[s.source]);
  const loading = useDiscoverStore((s) => s.loading);
  const error = useDiscoverStore((s) => s.error);
  const load = useDiscoverStore((s) => s.load);
  const retry = useDiscoverStore((s) => s.retry);

  // 只在排行榜 tab 挂载时加载；来源切换只重载当前 tab 的榜单（缓存/TTL 在 store）
  useEffect(() => {
    void load();
  }, [load, source]);

  const empty = chart.hotlist.length === 0 && chart.newSongs.length === 0;

  // 切源瞬间（setSource 已生效、effect 尚未发起 load）不能闪「榜单为空」：
  // 该来源从未加载过（loadedAt 为空）时按骨架处理，直到请求返回或失败。
  if (empty && (loading || (chart.loadedAt === null && error === null))) {
    return <HotlistSkeleton sections={2} rows={DISCOVER_CHART_ROWS} />;
  }

  if (empty && error) {
    return (
      <View style={styles.stateFill}>
        <DiscoverStateView title="榜单加载失败" message={error} onAction={retry} />
      </View>
    );
  }

  if (empty) {
    return (
      <View style={styles.stateFill}>
        <DiscoverStateView tone="empty" title="榜单为空" message="暂时没有拿到榜单内容" actionLabel="重新加载" onAction={retry} />
      </View>
    );
  }

  const sourceLabel = CHART_SOURCE_LABELS[source];
  const sections = [
    { key: `${source}-hot`, title: '热歌榜', routeTitle: `${sourceLabel} · 热歌榜`, routeKey: `${source}Hotlist`, songs: chart.hotlist },
    { key: `${source}-new`, title: '新歌榜', routeTitle: `${sourceLabel} · 新歌榜`, routeKey: `${source}New`, songs: chart.newSongs },
  ];

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={[
        styles.chartContent,
        { paddingBottom: bottomChromeHeight(insets.bottom, true, playerVisible) + LIST_TAIL_PADDING },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {chart.hotlist[0] ? (
        <DiscoverHero
          item={chart.hotlist[0]}
          sourceLabel={sourceLabel}
          onPress={() => { void playChartSong(chart.hotlist, 0, source); }}
        />
      ) : null}
      {error ? <InlineError message="榜单刷新失败" onRetry={retry} /> : null}
      {sections.map((section) => (
        <ChartSection
          key={section.key}
          title={section.title}
          routeTitle={section.routeTitle}
          routeKey={section.routeKey}
          songs={section.songs}
          sourceType={source}
        />
      ))}
    </ScrollView>
  );
}

function ChartSection({ title, routeTitle, routeKey, songs, sourceType }: {
  title: string;
  routeTitle: string;
  routeKey: string;
  songs: HotlistItem[];
  sourceType: SourceKey;
}) {
  const { colors, isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const onPlay = useCallback((index: number) => {
    void playChartSong(songs, index, sourceType);
  }, [songs, sourceType]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <ScalePress
          style={styles.sectionActionButton}
          onPress={() => router.push(`/hotlist?key=${routeKey}&title=${encodeURIComponent(routeTitle)}`)}
          accessibilityLabel={`查看全部${title}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.sectionAction}>查看全部</Text>
          <ChevronRight size={14} color={colors.accent} />
        </ScalePress>
      </View>
      {songs.slice(0, DISCOVER_CHART_ROWS).map((item, index) => (
        <ChartRow
          key={`${item.id}-${index}`}
          item={item}
          rank={index + 1}
          separator={index > 0 ? 'top' : 'none'}
          onPress={() => onPlay(index)}
        />
      ))}
    </View>
  );
}

/* ===== 新碟 ===== */
/**
 * 二级分类选择器：Apple Music「资料库」式文字 tabs——纯文字横滑，选中项加粗变深 + accent 下划线；
 * 零底色零圆角，层级让给一级内容 tab。
 */
function CategoryPills({ items, activeValue, onSelect }: {
  items: { label: string; value: string }[];
  activeValue: string;
  onSelect: (value: string) => void;
}) {
  const { isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  return (
    <View style={styles.catBar}>
      <TextTabs
        tabs={items.map((c) => ({ key: c.value, label: c.label }))}
        activeKey={activeValue}
        onSelect={(key) => onSelect(key)}
      />
    </View>
  );
}

function AlbumsContent() {
  const { colors, isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const insets = useSafeAreaInsets();
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [area, setArea] = useState('ALL');
  const [visibleCount, setVisibleCount] = useState(ALBUM_INITIAL_COUNT);
  // 最新分类的 ref：请求返回后与发起时比较，防切换分类后旧响应覆盖新列表
  const areaRef = useRef(area);
  areaRef.current = area;

  const load = useCallback(async () => {
    const areaAtStart = area;
    try {
      const r = await getDirectClient('netease')!.getNewAlbums!(areaAtStart, 0, 30);
      if (areaAtStart !== areaRef.current) return; // 分类已切换 → 丢弃过期响应
      setAlbums(r);
      setLoadingError(false);
    } catch {
      if (areaAtStart === areaRef.current) setLoadingError(true);
    }
  }, [area]);

  useEffect(() => {
    setLoading(true);
    setLoadingError(false);
    setVisibleCount(ALBUM_INITIAL_COUNT);
    load().finally(() => setLoading(false));
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    setLoadingError(false);
    void load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // 首屏/分类切换且无数据：骨架与真实布局同形（编辑推荐卡 → 分类条 → 三列网格）
  if (loading && albums.length === 0) {
    return (
      <View style={styles.tabContent}>
        <AlbumHeroSkeleton />
        <CategoryPills items={ALBUM_AREAS} activeValue={area} onSelect={setArea} />
        <GridSectionSkeleton columns={ALBUM_COLS} rows={ALBUM_INITIAL_ROWS} />
      </View>
    );
  }

  const featured = albums[0];
  const visibleAlbums = albums.slice(0, visibleCount);
  const hasMore = albums.length > visibleCount;

  const renderAlbum = ({ item: album }: { item: Album }) => (
    <ScalePress
      style={{ width: albumCardW }}
      pressScaleTo={pressScale.row}
      onPress={() => router.push(`/album/${album.id}?name=${encodeURIComponent(album.name)}&pic=${encodeURIComponent(album.picUrl)}&artist=${encodeURIComponent(album.artist)}` as any)}
      accessibilityLabel={`专辑 ${album.name}，${album.artist}`}
    >
      {album.picUrl ? (
        <LazyCover uri={album.picUrl} style={[styles.gridCover, { width: albumCardW, height: albumCardW }]} />
      ) : (
        <View style={[styles.gridCover, styles.gridCoverFallback, { width: albumCardW, height: albumCardW }]}>
          <Disc3 size={32} color={colors.textDisabled} />
        </View>
      )}
      <Text style={styles.gridName} numberOfLines={1}>{album.name}</Text>
      <Text style={styles.gridMeta} numberOfLines={1}>{album.artist}</Text>
    </ScalePress>
  );

  return (
    <View style={styles.tabContent}>
      <FlatList
        style={styles.tabContent}
        contentContainerStyle={[
          styles.albumListContent,
          { paddingBottom: bottomChromeHeight(insets.bottom, true, playerVisible) + LIST_TAIL_PADDING },
        ]}
        data={visibleAlbums}
        keyExtractor={(item) => item.id}
        renderItem={renderAlbum}
        {...listWindowProps}
        numColumns={ALBUM_COLS}
        columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: spacing[4] }}
        ListHeaderComponent={(
          <View>
            {featured ? <AlbumFeature album={featured} /> : null}
            <CategoryPills items={ALBUM_AREAS} activeValue={area} onSelect={setArea} />
            {loadingError && albums.length > 0 ? (
              <InlineError message="新碟刷新失败" onRetry={retry} />
            ) : null}
            {albums.length > 0 ? (
              <View style={styles.gridSectionHeader}>
                <Text style={styles.gridSectionTitle}>本周新碟</Text>
                {hasMore ? (
                  <ScalePress
                    onPress={() => setVisibleCount(albums.length)}
                    accessibilityLabel="查看全部新碟"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.sectionAction}>查看全部</Text>
                  </ScalePress>
                ) : null}
              </View>
            ) : null}
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          loadingError ? (
            <DiscoverStateView title="新碟加载失败" message="检查网络后重试" onAction={retry} />
          ) : (
            <DiscoverStateView tone="empty" title="暂无新碟" message="换个地区看看，或稍后重试" actionLabel="重新加载" onAction={retry} />
          )
        }
      />
    </View>
  );
}

function AlbumFeature({ album }: { album: Album }) {
  const { colors, isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  return (
    <ScalePress
      style={styles.albumFeature}
      pressScaleTo={pressScale.row}
      onPress={() => router.push(`/album/${album.id}?name=${encodeURIComponent(album.name)}&pic=${encodeURIComponent(album.picUrl)}&artist=${encodeURIComponent(album.artist)}` as any)}
      accessibilityLabel={`编辑推荐：${album.name}，${album.artist}`}
    >
      {album.picUrl ? (
        <LazyCover uri={album.picUrl} style={styles.albumFeatureCover} />
      ) : (
        <View style={[styles.albumFeatureCover, styles.gridCoverFallback]}>
          <Disc3 size={24} color={colors.textDisabled} />
        </View>
      )}
      <View style={styles.albumFeatureText}>
        <View style={styles.albumFeaturePill}>
          <Text style={styles.albumFeaturePillText}>编辑推荐</Text>
        </View>
        <Text style={styles.albumFeatureTitle} numberOfLines={2}>{album.name}</Text>
        <Text style={styles.albumFeatureMeta} numberOfLines={1}>{album.artist}</Text>
      </View>
      <ChevronRight size={18} color={colors.textSecondary} />
    </ScalePress>
  );
}

/** 编辑推荐卡骨架：与 AlbumFeature 同尺寸/同排布，数据到达不跳版。 */
function AlbumHeroSkeleton() {
  const { isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  return (
    <View style={styles.albumFeature}>
      <SkeletonBlock style={styles.albumFeatureCoverSkeleton} />
      <View style={styles.albumFeatureText}>
        <SkeletonBlock style={styles.skeletonPill} />
        <SkeletonBlock style={styles.skeletonTitle} />
        <SkeletonBlock style={styles.skeletonMeta} />
      </View>
      <SkeletonBlock style={styles.skeletonChevron} />
    </View>
  );
}

/** 网格区块骨架：标题行 + CoverGridSkeleton（列数与真实网格同源）。 */
function GridSectionSkeleton({ columns, rows }: { columns: number; rows: number }) {
  const { isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  return (
    <View style={styles.gridSectionSkeleton}>
      <View style={styles.gridSectionHeader}>
        <SkeletonBlock style={styles.skeletonSectionTitle} />
        <SkeletonBlock style={styles.skeletonSectionAction} />
      </View>
      <CoverGridSkeleton columns={columns} rows={rows} />
    </View>
  );
}

/* ===== 歌单 ===== */
function PlaylistContent() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [category, setCategory] = useState('全部');
  const offsetRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  // 最新分类的 ref：loadMore 请求返回后与发起时比较，防旧分类分页混入新分类列表
  const categoryRef = useRef(category);
  categoryRef.current = category;

  const load = useCallback(async () => {
    const catAtStart = category;
    try {
      const r = await getDirectClient('netease')!.getPlaylists!(catAtStart, 'hot', 0, 20);
      // 请求期间分类已切换 → 丢弃过期响应
      if (catAtStart !== categoryRef.current) return;
      setPlaylists(r.playlists);
      setHasMore(r.more);
      setLoadingError(false);
    } catch {
      if (catAtStart === categoryRef.current) setLoadingError(true);
    }
  }, [category]);

  useEffect(() => {
    setLoading(true);
    // 分类切换保留旧数据,避免闪烁
    setHasMore(true);
    setLoadingError(false);
    setMoreError(false);
    offsetRef.current = 0;
    load().finally(() => setLoading(false));
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    setLoadingError(false);
    void load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setMoreError(false);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    // 首屏未完成时不发分页请求：否则新分类可能以旧列表长度/偏移量发请求
    if (loading || loadingMore || !hasMore) return;
    const catAtStart = category;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const nextOffset = offsetRef.current + 20;
      const r = await getDirectClient('netease')!.getPlaylists!(catAtStart, 'hot', nextOffset, 20);
      // 请求期间分类已切换 → 丢弃过期结果，不推进 offset（否则混合列表 + 跳过新分类首页）
      if (catAtStart !== categoryRef.current) return;
      if (r.playlists.length > 0) {
        setPlaylists((prev) => [...prev, ...r.playlists]);
        offsetRef.current = nextOffset;
        setHasMore(r.more);
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[PlaylistContent] loadMore error:', e.message);
      if (catAtStart === categoryRef.current) setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, hasMore, category]);

  // 首屏(无数据)整页 loading;分类切换保留旧列表（分类条不能省，否则网格整体下移）
  if (loading && playlists.length === 0) {
    return (
      <View style={styles.tabContent}>
        <CategoryPills items={PLAYLIST_CATEGORIES} activeValue={category} onSelect={setCategory} />
        <CoverGridSkeleton columns={PLAYLIST_COLS} />
      </View>
    );
  }

  const renderItem = ({ item: p }: { item: DiscoverPlaylist }) => (
    <ScalePress
      style={{ width: playlistCardW }}
      pressScaleTo={pressScale.row}
      onPress={() => router.push(`/discover-playlist/${p.id}` as any)}
      accessibilityLabel={`歌单 ${p.name}`}
    >
      {p.coverImgUrl ? (
        <LazyCover uri={p.coverImgUrl} style={[styles.gridCover, { width: playlistCardW, height: playlistCardW }]} />
      ) : (
        <View style={[styles.gridCover, styles.gridCoverFallback, { width: playlistCardW, height: playlistCardW }]}>
          <ListMusic size={32} color={colors.textDisabled} />
        </View>
      )}
      <Text style={styles.gridName} numberOfLines={2}>{p.name}</Text>
      <Text style={styles.gridMeta}>{p.playCount ? formatPlayCount(p.playCount) : ''}</Text>
    </ScalePress>
  );

  return (
    <View style={styles.tabContent}>
      {/* 分类条固定顶部:不随列表滚动/不随数据变化重挂载,保持滑动位置 */}
      <CategoryPills
        items={PLAYLIST_CATEGORIES}
        activeValue={category}
        onSelect={(value) => setCategory(value)}
      />
      {/* 分类切换失败但保留了旧列表：错误必须可见，不能静默展示旧分类内容 */}
      {loadingError && playlists.length > 0 ? (
        <InlineError message="歌单刷新失败" onRetry={retry} />
      ) : null}
      <FlatList
        style={styles.tabContent}
        contentContainerStyle={[styles.tabContentInner, { paddingBottom: bottomChromeHeight(insets.bottom, true, playerVisible) + LIST_TAIL_PADDING }]}
        data={playlists}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        // 窗口档与其它长列表同源（#411）：RN 默认 21 屏对网格等于整份挂上
        {...listWindowProps}
        numColumns={PLAYLIST_COLS}
        columnWrapperStyle={{ gap: GRID_GAP }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          loadingError ? (
            <DiscoverStateView title="歌单加载失败" message="检查网络后重试" onAction={retry} />
          ) : (
            <DiscoverStateView tone="empty" title="暂无歌单" message="换个分类看看，或稍后重试" actionLabel="重新加载" onAction={retry} />
          )
        }
        ListFooterComponent={
          moreError ? (
            <InlineError message="加载更多失败" onRetry={loadMore} />
          ) : (
            <LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={playlists.length > 0} />
          )
        }
      />
    </View>
  );
}

/* ===== 歌手 ===== */
function ArtistContent() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const CARD_COLS = ARTIST_COLS; // 宽度用模块级 artistCardW（16 沟槽 + 2×12 列距）
  const [artists, setArtists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [category, setCategory] = useState('0');
  const [refreshing, setRefreshing] = useState(false);
  // 最新分类的 ref：loadMore 请求返回后与发起时比较，防旧分类分页混入新分类列表
  const categoryRef = useRef(category);
  categoryRef.current = category;

  const load = useCallback(async () => {
    const catAtStart = category;
    try {
      const r = await getDirectClient('netease')!.getArtists!(Number(catAtStart), 0, 30);
      if (catAtStart !== categoryRef.current) return; // 分类已切换 → 丢弃过期响应
      setArtists(r.artists);
      setHasMore(r.more);
      setLoadingError(false);
    } catch {
      if (catAtStart === categoryRef.current) setLoadingError(true);
    }
  }, [category]);

  useEffect(() => {
    setLoading(true);
    // 分类切换保留旧数据,避免闪烁
    setHasMore(true);
    setLoadingError(false);
    setMoreError(false);
    load().finally(() => setLoading(false));
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    setLoadingError(false);
    void load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setMoreError(false);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    // 首屏未完成时不发分页请求：否则 offset 取的是上一个分类的列表长度
    if (loading || loadingMore || !hasMore) return;
    const catAtStart = category;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const r = await getDirectClient('netease')!.getArtists!(Number(catAtStart), artists.length, 30);
      // 请求期间分类已切换 → 丢弃过期结果（旧分类第 N 页混入新分类列表）
      if (catAtStart !== categoryRef.current) return;
      if (r.artists.length > 0) {
        setArtists((prev) => [...prev, ...r.artists]);
        setHasMore(r.more);
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[ArtistContent] loadMore error:', e.message);
      if (catAtStart === categoryRef.current) setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, hasMore, artists.length, category]);

  // 首屏(无数据)整页 loading;分类切换保留旧列表（分类条同上：不能省）。
  // 歌手网格是**圆头像 + 居中名字**，故 variant='artist'（#416）。
  if (loading && artists.length === 0) {
    return (
      <View style={styles.tabContent}>
        <CategoryPills items={ARTIST_CATEGORIES} activeValue={category} onSelect={setCategory} />
        <CoverGridSkeleton columns={CARD_COLS} variant="artist" />
      </View>
    );
  }

  const renderItem = ({ item: a }: { item: any }) => (
    <ScalePress
      style={styles.artistCard}
      pressScaleTo={pressScale.row}
      onPress={() => router.push(`/artist/${a.id}?name=${encodeURIComponent(a.name)}&pic=${encodeURIComponent(a.picUrl || '')}` as any)}
      accessibilityLabel={`歌手 ${a.name}`}
    >
      {a.picUrl ? (
        <LazyCover uri={a.picUrl} style={styles.artistAvatar} />
      ) : (
        <View style={[styles.artistAvatar, styles.gridCoverFallback]}>
          <User size={28} color={colors.textDisabled} />
        </View>
      )}
      <Text style={styles.artistName} numberOfLines={1}>{a.name}</Text>
    </ScalePress>
  );

  return (
    <View style={styles.tabContent}>
      {/* 分类条固定顶部:不随列表滚动/不随数据变化重挂载,保持滑动位置 */}
      <CategoryPills
        items={ARTIST_CATEGORIES}
        activeValue={category}
        onSelect={(value) => setCategory(value)}
      />
      {/* 分类切换失败但保留了旧列表：错误必须可见，不能静默展示旧分类内容 */}
      {loadingError && artists.length > 0 ? (
        <InlineError message="歌手刷新失败" onRetry={retry} />
      ) : null}
      <FlatList
        style={styles.tabContent}
        contentContainerStyle={[styles.tabContentInner, { paddingBottom: bottomChromeHeight(insets.bottom, true, playerVisible) + LIST_TAIL_PADDING }]}
        data={artists}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        // 窗口档与其它长列表同源（#411）：RN 默认 21 屏对网格等于整份挂上
        {...listWindowProps}
        numColumns={CARD_COLS}
        // 卡片宽按含 2×12 gap 计算，行必须补 gap 才满宽居中（否则 3 卡左对齐、右侧空 24dp）
        columnWrapperStyle={styles.artistRow}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          loadingError ? (
            <DiscoverStateView title="歌手加载失败" message="检查网络后重试" onAction={retry} />
          ) : (
            <DiscoverStateView tone="empty" title="暂无歌手" message="换个分类看看，或稍后重试" actionLabel="重新加载" onAction={retry} />
          )
        }
        ListFooterComponent={
          moreError ? (
            <InlineError message="加载更多失败" onRetry={loadMore} />
          ) : (
            <LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={artists.length > 0} />
          )
        }
      />
    </View>
  );
}

/** 样式工厂：全部子组件共用一套样式，模块级预构建双主题两份（见文件底部 STYLES）。 */
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  // 读屏可见、视觉隐藏的页名（1×1 裁切）
  srHeading: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    color: colors.textPrimary,
  },
  // 顶部：内容 tab + 来源 chip（chip 只在排行榜 tab 出现）
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing[1],
    paddingRight: spacing[4],
  },
  headerTabs: { flex: 1, minWidth: 0 },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    height: spacing[8],
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgSurface,
  },
  sourceChipText: { ...textVariants.footnote, color: colors.textSecondary },
  content: { flex: 1 },
  // 整页空/错态：父级撑满后再居中（DiscoverStateView 自身不写 flex）
  stateFill: { flex: 1, justifyContent: 'center' },
  tabContent: { flex: 1 },
  // 网格 tab（歌单/歌手）：16pt 沟槽与 gridCardWidth 计算一致
  tabContentInner: { paddingHorizontal: spacing[4], paddingBottom: spacing[6] },
  // 新碟列表：横向沟槽由 columnWrapperStyle 负责（编辑推荐卡/分类条自带 16 沟槽）
  albumListContent: { paddingBottom: spacing[6] },
  // 排行榜：hero 与榜单卡自带横向沟槽，容器只管上下节奏
  chartContent: { paddingTop: spacing[2], paddingBottom: spacing[6] },
  // 二级分类：共享 TextTabs（文字+下划线），catBar 只管布局位
  catBar: { flexGrow: 0 },
  // 榜单卡：iOS inset grouped——白组坐底靠明度差分层，标题行/歌曲行之间发丝线分隔
  section: {
    backgroundColor: colors.bgSurface,
    marginHorizontal: HOTLIST_SECTION.marginHorizontal,
    marginTop: HOTLIST_SECTION.marginTop,
    borderRadius: HOTLIST_SECTION.radius,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HOTLIST_SECTION.headerPaddingHorizontal,
    paddingVertical: HOTLIST_SECTION.headerPaddingVertical,
    borderBottomWidth: SONG_ROW.separatorWidth,
    borderBottomColor: colors.borderSubtle,
  },
  sectionTitle: { ...textVariants.sectionHeader, color: colors.textPrimary },
  sectionActionButton: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  sectionAction: { ...textVariants.footnote, fontWeight: '500', color: colors.accent },
  // 网格区块标题行（新碟）
  gridSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[6],
    paddingBottom: spacing[2],
  },
  gridSectionTitle: { ...textVariants.sectionHeader, color: colors.textPrimary },
  // 新碟编辑推荐
  albumFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginHorizontal: spacing[4],
    marginTop: spacing[2],
    padding: spacing[2],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgSurface,
  },
  albumFeatureCover: {
    width: ALBUM_FEATURE_COVER,
    height: ALBUM_FEATURE_COVER,
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
  },
  albumFeatureText: { flex: 1 },
  albumFeaturePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
  },
  albumFeaturePillText: { ...textVariants.micro, color: colors.accentText },
  albumFeatureTitle: { ...textVariants.title, color: colors.textPrimary, marginTop: spacing[1] },
  albumFeatureMeta: { ...textVariants.caption, color: colors.textSecondary, marginTop: spacing[1] },
  // 专辑/歌单网格卡片：封面方圆角 md，标题两行截断，副行 meta——
  // 垂直节奏走 token（name 8 / meta 2），列距 gap 统一 12，无逐卡 margin
  gridCover: {
    borderRadius: GRID_CARD.coverRadius,
    backgroundColor: colors.bgHover,
  },
  gridCoverFallback: { alignItems: 'center', justifyContent: 'center' },
  gridName: {
    ...textVariants.footnote,
    fontWeight: '500',
    color: colors.textPrimary,
    marginTop: GRID_CARD.nameGap,
  },
  gridMeta: {
    ...textVariants.micro,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: GRID_CARD.metaGap,
  },
  // 歌手网格
  artistRow: { gap: GRID_GAP },
  artistCard: {
    width: artistCardW,
    alignItems: 'center',
    marginBottom: GRID_CARD.artistCardBottom,
  },
  artistAvatar: {
    width: GRID_CARD.artistAvatarSize,
    height: GRID_CARD.artistAvatarSize,
    borderRadius: radius.full,
    backgroundColor: colors.bgHover,
  },
  artistName: {
    ...textVariants.footnote,
    color: colors.textPrimary,
    marginTop: GRID_CARD.nameGap,
    textAlign: 'center',
  },
  // 骨架：编辑推荐卡与网格标题行
  albumFeatureCoverSkeleton: {
    width: ALBUM_FEATURE_COVER,
    height: ALBUM_FEATURE_COVER,
    borderRadius: radius.md,
  },
  skeletonPill: {
    width: '32%',
    height: textVariants.micro.lineHeight,
    borderRadius: radius.xs,
  },
  skeletonTitle: {
    width: '70%',
    height: textVariants.title.lineHeight,
    borderRadius: radius.xs,
    marginTop: spacing[2],
  },
  skeletonMeta: {
    width: '45%',
    height: textVariants.caption.lineHeight,
    borderRadius: radius.xs,
    marginTop: spacing[1],
  },
  skeletonChevron: {
    width: spacing[4],
    height: spacing[4],
    borderRadius: radius.xs,
  },
  gridSectionSkeleton: { flex: 1 },
  skeletonSectionTitle: {
    width: '32%',
    height: textVariants.sectionHeader.lineHeight,
    borderRadius: radius.xs,
  },
  skeletonSectionAction: {
    width: '18%',
    height: textVariants.footnote.lineHeight,
    borderRadius: radius.xs,
  },
  // 来源选择弹层
  sheetTitle: { ...textVariants.title, color: colors.textPrimary },
  sheetSub: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    marginTop: spacing[1],
    marginBottom: spacing[4],
  },
  sourceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radius.md,
  },
  sourceOptionPressed: { backgroundColor: colors.bgHover },
  sourceOptionText: { flex: 1, ...textVariants.body, color: colors.textPrimary },
});

const STYLES = {
  light: makeStyles(lightColors),
  dark: makeStyles(darkColors),
};
