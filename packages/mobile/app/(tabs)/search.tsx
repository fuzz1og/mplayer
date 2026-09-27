import { useEffect, useMemo, useState } from 'react';
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
import { CircleAlert, Music2, User } from 'lucide-react-native';
import { getDirectClient } from '@mplayer/core';
import type { SongGroup } from '@mplayer/core';
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
import { radius, textVariants } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, SEARCH_TAIL_PADDING } from '../../components/chromeMetrics';
import TextTabs from '../../components/TextTabs';

const SEARCH_TABS: { key: SearchTab; label: string }[] = [
  { key: 'songs', label: '歌曲' },
  { key: 'artists', label: '歌手' },
];


type SearchTab = 'songs' | 'artists';

// 歌手搜索序号（模块级）：慢响应不得覆盖新关键词的结果
let artistSearchSeq = 0;

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
  }, [q]);

  // 切换源时重新搜索（歌手仅网易云，不随源变）
  useEffect(() => {
    if (q) search(q);
  }, [source]);

  return (
    <Animated.View style={[styles.container, { paddingTop: topChromeHeight(insets.top), backgroundColor: animatedBg }]}>
      {/* 歌曲/歌手（后续可扩展歌单/专辑）：文字 tabs + 下划线，与发现页二级分类同语言 */}
      <TextTabs
        tabs={SEARCH_TABS}
        activeKey={activeTab}
        onSelect={(key) => setActiveTab(key as SearchTab)}
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
