import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions,
  Image, FlatList, RefreshControl,
} from 'react-native';
import { Music, Disc3, ListMusic, User } from 'lucide-react-native';
import { router } from 'expo-router';
import { musicApi, formatPlayCount } from '@mplayer/core';
import type { Song, SourceKey, DiscoverPlaylist, Album } from '@mplayer/core';
import {radius, shadow, spacing, textVariants} from '../theme/tokens';
import { lightColors, darkColors } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight } from './chromeMetrics';
import LoadingState from './LoadingState';
import LoadMoreFooter from './LoadMoreFooter';
import { useDiscoverStore, HotlistItem } from '../stores/discoverStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong as playAudio } from '../services/audioPlayer';
import { searchStrictMatch } from '../services/songResources';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TABS = [
  { key: 'hotlist', label: '排行榜' },
  { key: 'albums', label: '新碟' },
  { key: 'playlists', label: '歌单' },
  { key: 'artists', label: '歌手' },
];

export default function DiscoverTabs() {
  const { isDark } = useTheme();
  // 多子组件共用一套样式：模块级预构建两套（见文件底部 STYLES），按主题取用
  const styles = isDark ? STYLES.dark : STYLES.light;
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<FlatList<any>>(null);

  const onTabPress = (i: number) => {
    setActiveIndex(i);
    scrollRef.current?.scrollToOffset({ offset: i * SCREEN_WIDTH, animated: true });
  };

  const onMomentumEnd = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(idx);
  };

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: topChromeHeight(insets.top) }]}>
      {/* Bubble tab header */}
      <View style={styles.tabHeader}>
        {TABS.map((t, i) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => onTabPress(i)}
            style={[styles.tabItem, activeIndex === i && styles.tabItemActive]}
          >
            <Text style={[styles.tabLabel, activeIndex === i && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* Swipeable content：横向分页容器用 FlatList（VirtualizedList-backed），
          避免 ScrollView 内嵌 FlatList 触发「unique key」嵌套警告 */}
      <FlatList
        horizontal
        pagingEnabled
        ref={scrollRef}
        onMomentumScrollEnd={onMomentumEnd}
        showsHorizontalScrollIndicator={false}
        data={TABS}
        keyExtractor={(t) => t.key}
        initialNumToRender={1}
        windowSize={3}
        renderItem={({ index }) => (
          <View style={{ width: SCREEN_WIDTH }}>
            {index === 0 && <HotlistContent />}
            {index === 1 && activeIndex >= 1 && <AlbumsContent />}
            {index === 2 && activeIndex >= 2 && <PlaylistContent />}
            {index === 3 && activeIndex >= 3 && <ArtistContent />}
          </View>
        )}
      >
      </FlatList>
    </View>
  );
}

/* ===== 排行榜 Tab ===== */
function HotlistContent() {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const loading = useDiscoverStore(s => s.loading);
  const load = useDiscoverStore(s => s.load);
  const getSongs = useCallback((key: string) => {
    const state = useDiscoverStore.getState();
    return (state as any)[key] as HotlistItem[];
  }, []);

  useEffect(() => { load(); }, []);

  if (loading) return <LoadingState />;

  const SECTIONS = [
    { key: 'neteaseHotlist' as const, title: '网易云音乐 · 热歌榜', sourceType: 'netease' as SourceKey },
    { key: 'qqHotlist' as const, title: 'QQ 音乐 · 热歌榜', sourceType: 'qq' as SourceKey },
    { key: 'neteaseNew' as const, title: '网易云音乐 · 新歌榜', sourceType: 'netease' as SourceKey },
    { key: 'qqNew' as const, title: 'QQ 音乐 · 新歌榜', sourceType: 'qq' as SourceKey },
  ];

  return (
    <ScrollView style={styles.tabContent} contentContainerStyle={[styles.tabContentInnerHotlist, { paddingBottom: bottomChromeHeight(insets.bottom, true) + 24 }]}>
      {SECTIONS.map(section => (
        <SectionCard
          key={section.key}
          title={section.title}
          songs={getSongs(section.key)}
          routeKey={section.key}
          sourceType={section.sourceType}
        />
      ))}
    </ScrollView>
  );
}

function SectionCard({ title, songs, routeKey, sourceType }: { title: string; songs: HotlistItem[]; routeKey: string; sourceType: SourceKey }) {
  const { colors, isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const toSong = (item: HotlistItem): Song => ({
    id: item.id, name: item.name, artist: item.artists,
    album: item.album, cover: item.cover, url: '',
    lrc: '', duration: 0, sourceType,
  });

  const playSong = useCallback(async (item: HotlistItem, idx: number) => {
    let s: Song;
    try {
      // 热榜数据不含 url/lrc：路由搜索（直连 + tier3 兜底）+ 严格匹配，
      // 命中后只回填 url/lrc 再播原 item——不播搜索结果本体（防同名 cover 错播）
      const hit = await searchStrictMatch(toSong(item));
      s = hit ? { ...toSong(item), url: hit.url || '', lrc: hit.lrc || '' } : toSong(item);
    } catch {
      s = toSong(item);
    }
    const songQueue: Song[] = songs.map(toSong);
    // 当前歌曲替换为搜索结果(含 lrc、url 等)
    songQueue[idx] = s;
    usePlayerStore.getState().setQueue(songQueue, idx);
    playAudio(s);
  }, [sourceType, songs]);

  return (
    <View style={[styles.section, shadow.sm]}>
      <TouchableOpacity onPress={() => router.push(`/hotlist?key=${routeKey}&title=${encodeURIComponent(title)}`)}>
        <Text style={styles.sectionTitle}>{title} ›</Text>
      </TouchableOpacity>
      {songs.slice(0, 5).map((song, i) => (
        <TouchableOpacity key={song.id + String(i)} style={styles.songRow} onPress={() => playSong(song, i)}>
          <Text style={styles.rank}>{i + 1}</Text>
          {song.cover ? (
            <Image source={{ uri: song.cover }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, { backgroundColor: colors.bgHover, justifyContent: 'center', alignItems: 'center' }]}>
              <Music size={20} color={colors.textDisabled} />
            </View>
          )}
          <View style={styles.songInfo}>
            <Text style={styles.songName} numberOfLines={1}>{song.name}</Text>
            <Text style={styles.songArtist} numberOfLines={1}>{song.artists}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/* ===== 新碟 Tab ===== */
const ALBUM_AREAS = [
  { label: '全部', value: 'ALL' },
  { label: '华语', value: 'ZH' },
  { label: '欧美', value: 'EA' },
  { label: '韩国', value: 'KR' },
  { label: '日本', value: 'JP' },
];

/** 二级分类胶囊行（新碟/歌单/歌手共用） */
function CategoryPills({ items, activeLabel, onSelect }: {
  items: { label: string; value: string }[];
  activeLabel: string;
  onSelect: (label: string, value: string) => void;
}) {
  const { isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled style={styles.catBar} contentContainerStyle={styles.catBarContent}>
      {items.map((c) => (
        <TouchableOpacity
          key={c.value}
          onPress={() => onSelect(c.label, c.value)}
          style={[styles.catPill, activeLabel === c.label && styles.catPillActive]}
        >
          <Text style={[styles.catLabel, activeLabel === c.label && styles.catLabelActive]}>{c.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function AlbumsContent() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const CARD_GAP = 10;
  const CARD_COLS = 2;
  const cardW = (SCREEN_WIDTH - 12 * 2 - CARD_GAP) / CARD_COLS;
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [areaLabel, setAreaLabel] = useState('全部');
  // 最新分类的 ref：请求返回后与发起时比较，防切换分类后旧响应覆盖新列表
  const areaRef = useRef(areaLabel);
  areaRef.current = areaLabel;

  const load = useCallback(async () => {
    const areaAtStart = areaLabel;
    try {
      const area = ALBUM_AREAS.find(a => a.label === areaAtStart)?.value || 'ALL';
      const r = await musicApi.getNewAlbums(area, 0, 30);
      if (areaAtStart !== areaRef.current) return; // 分类已切换 → 丢弃过期响应
      setAlbums(r);
      setLoadingError(false);
    } catch {
      if (areaAtStart === areaRef.current) setLoadingError(true);
    }
  }, [areaLabel]);

  // 首屏(无数据)整页 loading;分类切换保留旧数据,避免闪烁
  useEffect(() => {
    setLoading(true);
    setLoadingError(false); // 新请求开始重置错误态
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // 首屏(无数据)整页 loading;分类切换保留旧数据,避免闪烁
  if (loading && albums.length === 0) return <LoadingState />;

  const renderItem = ({ item: album }: { item: Album }) => (
    <TouchableOpacity
      style={[styles.gridCard, { width: cardW }]}
      activeOpacity={0.7}
      onPress={() => router.push(`/album/${album.id}?name=${encodeURIComponent(album.name)}&pic=${encodeURIComponent(album.picUrl)}&artist=${encodeURIComponent(album.artist)}` as any)}
    >
      {album.picUrl ? (
        <Image source={{ uri: album.picUrl }} style={[styles.gridCover, { width: cardW, height: cardW }]} />
      ) : (
        <View style={[styles.gridCover, { width: cardW, height: cardW, backgroundColor: colors.bgHover, justifyContent: 'center', alignItems: 'center' }]}>
          <Disc3 size={32} color={colors.textDisabled} />
        </View>
      )}
      <Text style={styles.gridName} numberOfLines={1}>{album.name}</Text>
      <Text style={styles.gridMeta} numberOfLines={1}>{album.artist}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.tabContent}>
      {/* 分类条固定顶部:不随列表滚动/不随数据变化重挂载,保持滑动位置 */}
      <CategoryPills
        items={ALBUM_AREAS}
        activeLabel={areaLabel}
        onSelect={(label) => setAreaLabel(label)}
      />
      <FlatList
        style={styles.tabContent}
        contentContainerStyle={[styles.tabContentInner, { paddingBottom: bottomChromeHeight(insets.bottom, true) + 24 }]}
        data={albums}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={CARD_COLS}
        columnWrapperStyle={{ gap: CARD_GAP }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          loadingError ? (
            <View style={styles.catErrorBox}>
              <Text style={styles.catErrorText}>加载失败，下拉重试</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

/* ===== 歌单 Tab ===== */
const PLAYLIST_CATEGORIES = ['全部', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '爵士', '古典', 'R&B', '乡村', '小清新', '影视原声', '动漫', '怀旧', '治愈']
  .map(c => ({ label: c, value: c }));

function PlaylistContent() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const CARD_GAP = 10;
  const CARD_COLS = 2;
  const cardW = (SCREEN_WIDTH - 12 * 2 - CARD_GAP) / CARD_COLS;
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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
      const r = await musicApi.getNeteasePlaylists(catAtStart, 'hot', 0, 20);
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
    setLoadingError(false); // 新请求开始重置错误态
    offsetRef.current = 0;
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const catAtStart = category;
    setLoadingMore(true);
    try {
      const nextOffset = offsetRef.current + 20;
      const r = await musicApi.getNeteasePlaylists(catAtStart, 'hot', nextOffset, 20);
      // 请求期间分类已切换 → 丢弃过期结果，不推进 offset（否则混合列表 + 跳过新分类首页）
      if (catAtStart !== categoryRef.current) return;
      if (r.playlists.length > 0) {
        setPlaylists(prev => [...prev, ...r.playlists]);
        offsetRef.current = nextOffset;
        setHasMore(r.more);
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[PlaylistContent] loadMore error:', e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, category]);

  // 首屏(无数据)整页 loading;分类切换保留旧列表
  if (loading && playlists.length === 0) return <LoadingState />;

  const renderItem = ({ item: p }: { item: DiscoverPlaylist }) => (
    <TouchableOpacity
      style={[styles.gridCard, { width: cardW }]}
      activeOpacity={0.7}
      onPress={() => router.push(`/discover-playlist/${p.id}` as any)}
    >
      {p.coverImgUrl ? (
        <Image source={{ uri: p.coverImgUrl }} style={[styles.gridCover, { width: cardW, height: cardW }]} />
      ) : (
        <View style={[styles.gridCover, { width: cardW, height: cardW, backgroundColor: colors.bgHover, justifyContent: 'center', alignItems: 'center' }]}>
          <ListMusic size={32} color={colors.textDisabled} />
        </View>
      )}
      <Text style={styles.gridName} numberOfLines={1}>{p.name}</Text>
      <Text style={styles.gridMeta}>{p.playCount ? formatPlayCount(p.playCount) : ''}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.tabContent}>
      {/* 分类条固定顶部:不随列表滚动/不随数据变化重挂载,保持滑动位置 */}
      <CategoryPills
        items={PLAYLIST_CATEGORIES}
        activeLabel={category}
        onSelect={(label) => setCategory(label)}
      />
      <FlatList
        style={styles.tabContent}
        contentContainerStyle={[styles.tabContentInner, { paddingBottom: bottomChromeHeight(insets.bottom, true) + 24 }]}
        data={playlists}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        numColumns={CARD_COLS}
        columnWrapperStyle={{ gap: CARD_GAP }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          loadingError ? (
            <View style={styles.catErrorBox}>
              <Text style={styles.catErrorText}>加载失败，下拉重试</Text>
            </View>
          ) : null
        }
        ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={playlists.length > 0} />}
      />
    </View>
  );
}

/* ===== 歌手 Tab ===== */
/* ===== 歌手 Tab ===== */
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

function ArtistContent() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? STYLES.dark : STYLES.light;
  const CARD_COLS = 3;
  const [artists, setArtists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [category, setCategory] = useState('全部');
  const [refreshing, setRefreshing] = useState(false);
  // 最新分类的 ref：loadMore 请求返回后与发起时比较，防旧分类分页混入新分类列表
  const categoryRef = useRef(category);
  categoryRef.current = category;

  const load = useCallback(async () => {
    const catAtStart = category;
    try {
      const catId = Number(ARTIST_CATEGORIES.find(c => c.label === catAtStart)?.value || 0);
      const r = await musicApi.getNeteaseArtists(catId, 0, 30);
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
    setLoadingError(false); // 新请求开始重置错误态
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const catAtStart = category;
    setLoadingMore(true);
    try {
      const catId = Number(ARTIST_CATEGORIES.find(c => c.label === category)?.value || 0);
      const r = await musicApi.getNeteaseArtists(catId, artists.length, 30);
      // 请求期间分类已切换 → 丢弃过期结果（旧分类第 N 页混入新分类列表）
      if (catAtStart !== categoryRef.current) return;
      if (r.artists.length > 0) {
        setArtists(prev => [...prev, ...r.artists]);
        setHasMore(r.more);
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[ArtistContent] loadMore error:', e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, artists.length, category]);

  // 首屏(无数据)整页 loading;分类切换保留旧列表
  if (loading && artists.length === 0) return <LoadingState />;

  const renderItem = ({ item: a }: { item: any }) => (
    <TouchableOpacity
      style={styles.artistCard}
      activeOpacity={0.7}
      onPress={() => router.push(`/artist/${a.id}?name=${encodeURIComponent(a.name)}&pic=${encodeURIComponent(a.picUrl || '')}` as any)}
    >
      {a.picUrl ? (
        <Image source={{ uri: a.picUrl }} style={styles.artistAvatar} />
      ) : (
        <View style={[styles.artistAvatar, { backgroundColor: colors.bgHover, justifyContent: 'center', alignItems: 'center' }]}>
          <User size={28} color={colors.textDisabled} />
        </View>
      )}
      <Text style={styles.artistName} numberOfLines={1}>{a.name}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.tabContent}>
      {/* 分类条固定顶部:不随列表滚动/不随数据变化重挂载,保持滑动位置 */}
      <CategoryPills
        items={ARTIST_CATEGORIES}
        activeLabel={category}
        onSelect={(label) => setCategory(label)}
      />
      <FlatList
        style={styles.tabContent}
        contentContainerStyle={[styles.tabContentInner, { paddingBottom: bottomChromeHeight(insets.bottom, true) + 24 }]}
        data={artists}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={CARD_COLS}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          loadingError ? (
            <View style={styles.catErrorBox}>
              <Text style={styles.catErrorText}>加载失败，下拉重试</Text>
            </View>
          ) : null
        }
        ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={artists.length > 0} />}
      />
    </View>
  );
}

/** 样式工厂：7 个子组件共用一套样式，模块级预构建双主题两份（见各组件内按 isDark 取用） */
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  // Bubble tab header
  tabHeader: {
    flexDirection: 'row',
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing[4],
    paddingVertical: 10,
    gap: spacing[2],
  },
  tabItem: {
    flex: 1,
    paddingVertical: spacing[2],
    borderRadius: radius.full, // 气泡 tab 统一全圆角（与搜索页 tab 一致）
    backgroundColor: colors.bgHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItemActive: {
    backgroundColor: colors.accent,
  },
  tabLabel: {
    ...textVariants.subhead,
    color: colors.textSecondary,
  },
  tabLabelActive: {
    color: colors.textInverse,
    fontWeight: '600',
  },
  tabContent: { flex: 1 },
  // 网格 tab（新碟/歌单/歌手）：与 cardW 计算的左右 12px 边距对齐，保证卡片居中
  tabContentInner: { paddingHorizontal: spacing[3], paddingBottom: spacing[6] },
  // 热榜：section 自带 marginHorizontal: 12，不加容器 padding 避免边距翻倍
  tabContentInnerHotlist: { paddingBottom: spacing[6] },
  // 二级分类胶囊
  catBar: { flexGrow: 0 },
  catBarContent: { gap: spacing[2], paddingVertical: 10 },
  catPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full, // 分类胶囊统一全圆角
    backgroundColor: colors.bgHover,
  },
  catPillActive: {
    backgroundColor: colors.accent,
  },
  catLabel: {
    ...textVariants.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  catLabelActive: {
    color: colors.textInverse,
    fontWeight: '600',
  },
  catErrorBox: {
    alignItems: 'center',
    paddingTop: 60,
  },
  catErrorText: {
    ...textVariants.subhead,
    fontWeight: '400',
    color: colors.danger,
  },
  // Hotlist section styles
  section: {
    backgroundColor: colors.bgSurface,
    marginHorizontal: spacing[3],
    marginTop: spacing[3],
    borderRadius: radius.md,
    padding: spacing[3],
  },
  sectionTitle: {
    ...textVariants.sectionHeader,
    color: colors.textPrimary,
    marginBottom: spacing[3],
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rank: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.textTertiary,
    width: 28,
    textAlign: 'center',
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    marginRight: 10,
  },
  songInfo: { flex: 1 },
  songName: { ...textVariants.subhead, fontWeight: '400', color: colors.textPrimary },
  songArtist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  // Playlist grid styles
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 10,
  },
  gridCard: {
    marginBottom: spacing[1],
  },
  gridCover: {
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
  },
  gridName: {
    ...textVariants.footnote,
    fontWeight: '500',
    color: colors.textPrimary,
    marginTop: 6,
  },
  gridMeta: {
    ...textVariants.micro,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: 2,
  },
  // Artist grid styles
  artistGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  artistCard: {
    width: (SCREEN_WIDTH - 24) / 3,
    alignItems: 'center',
    marginBottom: spacing[5],
  },
  artistAvatar: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.bgHover,
  },
  artistName: {
    ...textVariants.footnote,
    color: colors.textPrimary,
    marginTop: 6,
    textAlign: 'center',
  },
});

const STYLES = {
  light: makeStyles(lightColors),
  dark: makeStyles(darkColors),
};
