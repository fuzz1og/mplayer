import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { CircleAlert, Music2, User } from 'lucide-react-native';
import { musicApi } from '@mplayer/core';
import { useSearchStore } from '../../stores/searchStore';
import { useSourceStore } from '../../stores/sourceStore';
import SongRow from '../../components/SongRow';
import SongListSkeleton from '../../components/SongListSkeleton';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import {radius, spacing, textVariants} from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight } from '../../components/chromeMetrics';
import ScalePress from '../../components/ScalePress';

const SEARCH_TABS: { key: SearchTab; label: string }[] = [
  { key: 'songs', label: '歌曲' },
  { key: 'artists', label: '歌手' },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type SearchTab = 'songs' | 'artists';

// 歌手搜索序号（模块级）：慢响应不得覆盖新关键词的结果
let artistSearchSeq = 0;

export default function SearchPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
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
      const r = await musicApi.searchNeteaseArtists(kw, 30);
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
    <View style={[styles.container, { paddingTop: topChromeHeight(insets.top) }]}>
      {/* 歌曲/歌手（后续可扩展歌单/专辑）：气泡 tab 平分整行 */}
      <View style={styles.tabHeader}>
        {SEARCH_TABS.map((t) => (
          <ScalePress
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[styles.tabItem, activeTab === t.key && styles.tabItemActive]}
          >
            <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </ScalePress>
        ))}
      </View>

      {activeTab === 'songs' ? (
        // 渐进搜索:有结果就显示(即使还在加载),骨架屏只在无结果时出现
        loading && results.length === 0 ? (
          <SongListSkeleton />
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
        // 歌手加载也用骨架屏
        <View style={{ paddingTop: 8 }}>
          <SongListSkeleton rows={6} />
        </View>
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
          contentContainerStyle={[
            styles.artistGrid,
            { paddingBottom: bottomChromeHeight(insets.bottom, false) + 16 },
          ]}
          renderItem={({ item: a }) => (
            <TouchableOpacity
              style={styles.artistCard}
              activeOpacity={0.7}
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
            </TouchableOpacity>
          )}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <User size={48} color={colors.textDisabled} />
          <Text style={styles.emptyText}>未找到相关歌手</Text>
        </View>
      )}
    </View>
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
  return (
    <FlatList
      key="song-results"
      data={results}
      keyExtractor={(item) => item.key}
      contentContainerStyle={{ paddingBottom: bottomChromeHeight(insets.bottom, false) + 16 }}
      renderItem={({ item: group }) => (
        <View style={styles.groupSection}>
          {(group.name || group.artist) ? (
            <Text style={styles.groupHeader}>
              {group.name}
              {group.artist ? <Text style={styles.groupArtist}> — {group.artist}</Text> : null}
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
  return (
    <FlatList
      key="song-results"
      data={results}
      keyExtractor={(item) => item.key}
      contentContainerStyle={{ paddingBottom: bottomChromeHeight(insets.bottom, false) + 16 }}
      renderItem={({ item: group }) => (
        <View style={styles.groupSection}>
          {group.name ? <Text style={styles.groupHeader}>{group.name}</Text> : null}
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
  container: { flex: 1, backgroundColor: colors.bgBase },
  tabHeader: {
    flexDirection: 'row',
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  tabItem: {
    flex: 1,
    paddingVertical: spacing[2],
    borderRadius: radius.full,
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
  groupSection: { marginBottom: 8 },
  groupHeader: {
    ...textVariants.footnote,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.bgSurface,
    marginTop: 8,
    marginHorizontal: 12,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  groupArtist: { color: colors.textSecondary, fontWeight: '400' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: { ...textVariants.callout, color: colors.textSecondary, marginTop: 12 },
  artistGrid: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
  },
  artistCard: {
    width: (SCREEN_WIDTH - 24) / 3,
    alignItems: 'center',
    marginBottom: 20,
  },
  artistAvatar: {
    width: 72,
    height: 72,
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
    marginTop: 6,
    textAlign: 'center',
  },
});
