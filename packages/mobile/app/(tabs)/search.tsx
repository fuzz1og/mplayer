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
import { useSearchStore } from '../../stores/searchStore';
import { useSourceStore } from '../../stores/sourceStore';
import { usePlayerStore } from '../../stores/playerStore';
import SongRow from '../../components/SongRow';
import SongListSkeleton from '../../components/SongListSkeleton';
import CoverGridSkeleton from '../../components/CoverGridSkeleton';
import { GRID_CARD } from '../../components/gridCardMetrics';
import { GRID_GAP, gridCardWidth } from '../../components/gridMetrics';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import {radius, spacing, textVariants} from '../../theme/tokens';
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
  results: import('@mplayer/core').SongGroup[];
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  hasMore: boolean;
}

/**
 * 多源搜索(全部源)结果:按歌分组,标题 = 歌名 — 歌手,组内为各源版本
 */
function MultiSourceResults({ results, loadMore, loadingMore, hasMore }: ResultsListProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  return (
    <FlatList
      key="song-results"
      data={results}
      keyExtractor={(item) => item.key}
      contentContainerStyle={{ paddingBottom: bottomChromeHeight(insets.bottom, false, playerVisible) + SEARCH_TAIL_PADDING }}
      renderItem={({ item: group }) => (
        <View style={styles.groupSection}>
          {(group.name || group.artist) ? (
            <Text style={styles.groupHeader}>
              {group.name}
              {group.artist ? <Text style={styles.groupArtist}> — {group.artist}</Text> : null}
              {group.songs.length > 1 && <Text style={styles.groupCount}>· {group.songs.length} 个版本</Text>}
            </Text>
          ) : null}
          {group.songs.map((song, i) => (
            <SongRow key={`${song.id}-${i}`} song={song} showSource queueSongs={group.songs} />
          ))}
        </View>
      )}
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  return (
    <FlatList
      key="song-results"
      data={results}
      keyExtractor={(item) => item.key}
      contentContainerStyle={{ paddingBottom: bottomChromeHeight(insets.bottom, false, playerVisible) + SEARCH_TAIL_PADDING }}
      renderItem={({ item: group }) => (
        <View style={styles.groupSection}>
          {group.name ? (
            <Text style={styles.groupHeaderLabel}>
              {group.name}
              {group.songs.length > 1 && <Text style={styles.groupCount}>· {group.songs.length} 首</Text>}
            </Text>
          ) : null}
          {group.songs.map((song, i) => (
            <SongRow key={`${song.id}-${i}`} song={song} showSource queueSongs={group.songs} />
          ))}
        </View>
      )}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={results.length > 0} />}
    />
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 主题切换平滑过渡（M3）：根部应用共享 Animated 背景色
  container: { flex: 1 },
  groupSection: { marginBottom: 12 },
  // 组头 = 沟槽对齐的静默标签（无卡片底）：多源视图标题是歌名，单源视图标题是源名，
  // 行保持全出血——沿用推荐页「标签 + 全出血行」的列表语言，避免内嵌卡与行断裂
  groupHeader: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: 4,
  },
  groupHeaderLabel: {
    ...textVariants.footnote,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: 4,
  },
  groupArtist: { color: colors.textSecondary, fontWeight: '400' },
  groupCount: { ...textVariants.caption, color: colors.textTertiary, fontWeight: '400', marginLeft: spacing[2] },
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
