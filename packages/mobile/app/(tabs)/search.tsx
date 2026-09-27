import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import ScalePress from '../../components/ScalePress';
import { useLocalSearchParams, router } from 'expo-router';
import { CircleAlert, ListMusic, Music2, User } from 'lucide-react-native';
import { formatPlayCount, getDirectClient } from '@mplayer/core';
import type { DiscoverPlaylist, SongGroup } from '@mplayer/core';
import { useSearchStore } from '../../stores/searchStore';
import { useSourceStore } from '../../stores/sourceStore';
import { usePlayerStore } from '../../stores/playerStore';
import SongList from '../../components/SongList';
import type { SongListRow } from '../../components/SongList';
import SongListSkeleton from '../../components/SongListSkeleton';
import CoverGridSkeleton from '../../components/CoverGridSkeleton';
import { GRID_CARD } from '../../components/gridCardMetrics';
import { GRID_GAP, gridCardWidth } from '../../components/gridMetrics';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import { radius, spacing, textVariants } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, SEARCH_TAIL_PADDING } from '../../components/chromeMetrics';
import TextTabs from '../../components/TextTabs';

const SEARCH_TABS: { key: SearchTab; label: string }[] = [
  { key: 'songs', label: '歌曲' },
  { key: 'artists', label: '歌手' },
  { key: 'playlists', label: '歌单' },
];


type SearchTab = 'songs' | 'artists' | 'playlists';

// 歌手/歌单搜索序号（模块级）：慢响应不得覆盖新关键词的结果
let artistSearchSeq = 0;
let playlistSearchSeq = 0;

export default function SearchPage() {
  const { colors } = useTheme();
  const animatedBg = useAnimatedBg();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  // ADR-0008：首次播放前迷你播放栏隐藏，让位随之缩小
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const params = useLocalSearchParams<{ q: string; type?: string }>();
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  const type = Array.isArray(params.type) ? params.type[0] : params.type;
  const results = useSearchStore((s) => s.results);
  const loading = useSearchStore((s) => s.loading);
  const loadingMore = useSearchStore((s) => s.loadingMore);
  const hasMore = useSearchStore((s) => s.hasMore);
  const error = useSearchStore((s) => s.error);
  const search = useSearchStore((s) => s.search);
  const loadMore = useSearchStore((s) => s.loadMore);
  const query = useSearchStore((s) => s.query);
  const source = useSourceStore((s) => s.selectedSource);

  // 从「搜索歌手」进入时默认落在歌手 tab；普通搜索回到歌曲 tab
  // （tab 页跨导航常驻，仅挂载时设置会导致歌手 tab 粘滞）
  const [activeTab, setActiveTab] = useState<SearchTab>(type === 'artist' ? 'artists' : 'songs');
  useEffect(() => {
    setActiveTab(type === 'artist' ? 'artists' : 'songs');
  }, [q, type]);
  const [artists, setArtists] = useState<any[]>([]);
  const [artistsLoading, setArtistsLoading] = useState(false);
  const [artistsError, setArtistsError] = useState(false);
  // 歌单（#415）：懒加载 —— 只有切到「歌单」tab 才发请求（见 searchPlaylists）
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState(false);
  /** 已发起搜索的关键词：同关键词来回切 tab 不重复发（换关键词时清空）。 */
  const playlistKeywordRef = useRef<string | null>(null);

  /**
   * 歌单搜索（#415）。**懒加载**：只有切到「歌单」tab 才调 —— `cloudsearch/pc` 已是
   * 搜索页在用的腿（关键词变化时网易打 1 发搜索），歌单搜索若也随关键词无条件再打一发，
   * 该腿请求数直接翻倍。core 侧另有 6h 缓存 + 同键单飞兜底，这里只做「同关键词只发一次」。
   */
  const searchPlaylists = async (kw: string, force = false) => {
    if (!kw) return;
    if (!force && playlistKeywordRef.current === kw) return;
    playlistKeywordRef.current = kw;
    const seq = ++playlistSearchSeq;
    setPlaylistsLoading(true);
    setPlaylistsError(false);
    try {
      const page = await getDirectClient('netease')!.searchPlaylists!(kw, 30);
      if (seq !== playlistSearchSeq) return; // 已被新搜索取代，丢弃迟到结果
      setPlaylists(page.playlists);
    } catch (e: any) {
      if (seq !== playlistSearchSeq) return;
      console.error('[Search] playlists error:', e.message);
      setPlaylists([]);
      setPlaylistsError(true);
    } finally {
      if (seq === playlistSearchSeq) setPlaylistsLoading(false);
    }
  };

  // 歌手搜索序号：慢响应不得覆盖新关键词的结果
  const searchArtists = async (kw: string) => {
    if (!kw) return;
    const seq = ++artistSearchSeq;
    setArtistsLoading(true);
    setArtistsError(false);
    try {
      const r = await getDirectClient('netease')!.searchArtists!(kw, 30);
      if (seq !== artistSearchSeq) return; // 已被新搜索取代，丢弃迟到结果
      setArtists(r);
    } catch (e: any) {
      if (seq !== artistSearchSeq) return;
      console.error('[Search] artists error:', e.message);
      setArtistsError(true);
    } finally {
      if (seq === artistSearchSeq) setArtistsLoading(false);
    }
  };

  useEffect(() => {
    if (q && q !== query) {
      search(q);
    }
    if (q) searchArtists(q);
    // 歌单：#415 换关键词作废旧结果与「已搜索」标记，但**不在这里发请求**（懒加载）
    playlistKeywordRef.current = null;
    setPlaylists([]);
    setPlaylistsError(false);
  }, [q]);

  // 切换源时重新搜索（歌手仅网易云，不随源变）
  useEffect(() => {
    if (q) search(q);
  }, [source]);

  return (
    <Animated.View style={[styles.container, { paddingTop: topChromeHeight(insets.top), backgroundColor: animatedBg }]}>
      {/* 歌曲/歌手/歌单（#415）：文字 tabs + 下划线，与发现页二级分类同语言 */}
      <TextTabs
        tabs={SEARCH_TABS}
        activeKey={activeTab}
        onSelect={(key) => {
          const next = key as SearchTab;
          setActiveTab(next);
          // 懒加载：切到「歌单」tab 才打这一发（同关键词重复切不会重复发）
          if (next === 'playlists') void searchPlaylists(q);
        }}
        scrollable={false}
      />

      {activeTab === 'songs' ? (
        // 渐进搜索:有结果就显示(即使还在加载),骨架屏只在无结果时出现
        loading && results.length === 0 ? (
          <SongListSkeleton showSource />
        ) : error && results.length === 0 ? (
          <View style={styles.emptyContainer}>
            <CircleAlert size={48} color={colors.danger} />
            <Text style={[styles.emptyText, { color: colors.danger }]}>{error}</Text>
          </View>
        ) : results.length > 0 ? (
          // 多源/单源分开渲染:全部源按歌分组(同歌各源合并),单源按源分组
          source === 'all' ? (
            <MultiSourceResults results={results} loadMore={loadMore} loadingMore={loadingMore} hasMore={hasMore} />
          ) : (
            <SingleSourceResults results={results} loadMore={loadMore} loadingMore={loadingMore} hasMore={hasMore} />
          )
        ) : (
          <View style={styles.emptyContainer}>
            <Music2 size={48} color={colors.textDisabled} />
            <Text style={styles.emptyText}>搜索歌曲和歌手</Text>
          </View>
        )
      ) : activeTab === 'playlists' ? (
        // 歌单（#415）：复用发现页同款 2 列方图卡片与既有歌单详情页
        playlistsLoading && playlists.length === 0 ? (
          <CoverGridSkeleton columns={2} />
        ) : playlistsError ? (
          <View style={styles.emptyContainer}>
            <CircleAlert size={48} color={colors.danger} />
            <Text style={[styles.emptyText, { color: colors.danger }]}>歌单搜索失败</Text>
            <ScalePress style={styles.retryButton} onPress={() => void searchPlaylists(q, true)}>
              <Text style={styles.retryText}>重试</Text>
            </ScalePress>
          </View>
        ) : playlists.length > 0 ? (
          <FlatList
            key="playlist-results"
            data={playlists}
            keyExtractor={(item) => String(item.id)}
            numColumns={2}
            columnWrapperStyle={styles.playlistRow}
            contentContainerStyle={[
              styles.playlistGrid,
              { paddingBottom: bottomChromeHeight(insets.bottom, false, playerVisible) + SEARCH_TAIL_PADDING },
            ]}
            renderItem={({ item: p }) => (
              <ScalePress
                style={styles.playlistCard}
                onPress={() => router.push(`/discover-playlist/${p.id}` as any)}
              >
                {p.coverImgUrl ? (
                  <Image source={{ uri: p.coverImgUrl }} style={styles.playlistCover} />
                ) : (
                  <View style={[styles.playlistCover, styles.playlistCoverFallback]}>
                    <ListMusic size={28} color={colors.textDisabled} />
                  </View>
                )}
                <Text style={styles.playlistName} numberOfLines={2}>{p.name}</Text>
                <Text style={styles.playlistMeta} numberOfLines={1}>
                  {p.playCount ? formatPlayCount(p.playCount) : ''}
                </Text>
              </ScalePress>
            )}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <ListMusic size={48} color={colors.textDisabled} />
            <Text style={styles.emptyText}>没有搜到歌单，去发现页看看歌单广场</Text>
          </View>
        )
      ) : artistsLoading ? (
        // 歌手加载：**必须用网格骨架**（真实结果是 3 列圆头像 + 居中名字）。
        // 此前这里是 SongListSkeleton——歌手页加载出「歌曲行」形状，结构完全不匹配（#416）。
        <CoverGridSkeleton columns={3} variant="artist" />
      ) : artistsError ? (
        <View style={styles.emptyContainer}>
          <CircleAlert size={48} color={colors.danger} />
          <Text style={[styles.emptyText, { color: colors.danger }]}>歌手搜索失败</Text>
        </View>
      ) : artists.length > 0 ? (
        <FlatList
          key="artist-results"
          data={artists}
          keyExtractor={(item) => String(item.id)}
          numColumns={3}
          columnWrapperStyle={styles.artistRow}
          contentContainerStyle={[
            styles.artistGrid,
            { paddingBottom: bottomChromeHeight(insets.bottom, false, playerVisible) + SEARCH_TAIL_PADDING },
          ]}
          renderItem={({ item: a }) => (
            <ScalePress
              style={styles.artistCard}
              onPress={() => router.push(`/artist/${a.id}?name=${encodeURIComponent(a.name)}&pic=${encodeURIComponent(a.picUrl || '')}` as any)}
            >
              {a.picUrl ? (
                <Image source={{ uri: a.picUrl }} style={styles.artistAvatar} />
              ) : (
                <View style={[styles.artistAvatar, styles.artistAvatarFallback]}>
                  <User size={28} color={colors.textDisabled} />
                </View>
              )}
              <Text style={styles.artistName} numberOfLines={1}>{a.name}</Text>
            </ScalePress>
          )}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <User size={48} color={colors.textDisabled} />
          <Text style={styles.emptyText}>未找到相关歌手</Text>
        </View>
      )}
    </Animated.View>
  );
}

interface ResultsListProps {
  results: SongGroup[];
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  hasMore: boolean;
}

/**
 * **拍平**搜索结果（#411）：把「组」拆成「组头行 + 歌曲行」。
 *
 * 此前把「组」当 cell、组内 `group.songs.map()` 全量渲染——一个 30 首的组就是一次性
 * 挂 30 行，虚拟化完全绕过去了。拍平后才是逐行虚拟化。
 *
 * 两种视图只差组头的内容与档位（多源 = 歌名 — 歌手 +「N 个版本」；单源 = 源名 +「N 首」），
 * 所以共用一个函数。key 用 `组键:歌曲 id`（歌曲 id 含源前缀，组内不会重），**不含 index**。
 */
function flattenSongGroups(results: SongGroup[], mode: 'multi' | 'single'): SongListRow[] {
  const flat: SongListRow[] = [];
  for (const group of results) {
    const hasHeader = mode === 'multi' ? Boolean(group.name || group.artist) : Boolean(group.name);
    if (hasHeader) {
      flat.push({
        kind: 'groupHeader',
        key: `${group.key}:header`,
        title: group.name,
        subtitle: mode === 'multi' ? group.artist || undefined : undefined,
        note: group.songs.length > 1 ? `${group.songs.length} ${mode === 'multi' ? '个版本' : '首'}` : undefined,
        quiet: mode === 'single',
      });
    }
    for (const song of group.songs) {
      flat.push({
        kind: 'song',
        key: `${group.key}:${song.id}`,
        song,
        showSource: true,
        queueSongs: group.songs,
      });
    }
  }
  return flat;
}

/**
 * 多源搜索(全部源)结果:按歌分组,标题 = 歌名 — 歌手,组内为各源版本
 */
function MultiSourceResults({ results, loadMore, loadingMore, hasMore }: ResultsListProps) {
  const insets = useSafeAreaInsets();
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));

  const rows = useMemo(() => flattenSongGroups(results, 'multi'), [results]);

  return (
    <SongList
      rows={rows}
      contentContainerStyle={{ paddingBottom: bottomChromeHeight(insets.bottom, false, playerVisible) + SEARCH_TAIL_PADDING }}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={results.length > 0} />}
    />
  );
}

/**
 * 单源搜索结果:按源分组,标题 = 源名,组内为该源歌曲列表
 */
function SingleSourceResults({ results, loadMore, loadingMore, hasMore }: ResultsListProps) {
  const insets = useSafeAreaInsets();
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));

  const rows = useMemo(() => flattenSongGroups(results, 'single'), [results]);

  return (
    <SongList
      rows={rows}
      contentContainerStyle={{ paddingBottom: bottomChromeHeight(insets.bottom, false, playerVisible) + SEARCH_TAIL_PADDING }}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={results.length > 0} />}
    />
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 主题切换平滑过渡（M3）：根部应用共享 Animated 背景色
  container: { flex: 1 },
  // 组头样式已随「拍平」搬进 components/SongList.tsx（groupHeader / groupHeaderQuiet 两档）：
  // 组头现在是列表里的**行**，样式跟着行组件走，不再由页面各写一份（#411）。
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: { ...textVariants.callout, color: colors.textSecondary, marginTop: 12 },
  retryButton: {
    marginTop: spacing[4],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.bgHover,
  },
  retryText: { ...textVariants.footnote, color: colors.accent },
  // 歌单网格（#415）：与发现页歌单 tab 同款 2 列方图卡片。
  // 度量统一走 gridMetrics/gridCardMetrics（#416：禁止在调用方重写宽度公式）。
  playlistGrid: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[6],
  },
  // numColumns 的**行容器**才认列距（与 artistRow 同一写法）
  playlistRow: { gap: GRID_GAP },
  playlistCard: { width: gridCardWidth({ cols: 2 }) },
  playlistCover: {
    width: gridCardWidth({ cols: 2 }),
    height: gridCardWidth({ cols: 2 }),
    borderRadius: GRID_CARD.coverRadius,
    backgroundColor: colors.bgHover,
  },
  playlistCoverFallback: { justifyContent: 'center', alignItems: 'center' },
  playlistName: {
    ...textVariants.footnote,
    fontWeight: '500',
    color: colors.textPrimary,
    marginTop: GRID_CARD.nameGap,
  },
  playlistMeta: {
    ...textVariants.micro,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: GRID_CARD.metaGap,
  },
  // 歌手网格与发现页歌手网格统一：宽度走 gridMetrics（#416 前这里是
  // (SCREEN_WIDTH - 24) / 3 —— 与 gridMetrics「禁止在调用方重写公式」相悖的第三个公式），
  // 度量走 gridCardMetrics，骨架屏（CoverGridSkeleton variant="artist"）与页面同源。
  artistGrid: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[6],
  },
  // numColumns 的**行容器**才认列距（contentContainerStyle 的 gap 管不到行内）——
  // 与 DiscoverTabs 的 artistRow 同一写法，否则 3 卡左对齐、右侧空出 gap×2。
  artistRow: { gap: GRID_GAP },
  artistCard: {
    width: gridCardWidth({ cols: 3 }),
    alignItems: 'center',
    marginBottom: GRID_CARD.artistCardBottom,
  },
  artistAvatar: {
    width: GRID_CARD.artistAvatarSize,
    height: GRID_CARD.artistAvatarSize,
    borderRadius: radius.full,
    backgroundColor: colors.bgHover,
  },
  artistAvatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgHover,
  },
  artistName: {
    ...textVariants.footnote,
    color: colors.textPrimary,
    marginTop: GRID_CARD.nameGap,
    textAlign: 'center',
  },
});
