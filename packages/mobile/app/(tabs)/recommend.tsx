import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, RefreshControl, StyleSheet, TouchableOpacity, Image, Animated,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, SECTION_TAIL_PADDING } from '../../components/chromeMetrics';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import { gridCardWidth } from '../../components/gridMetrics';

import { CircleAlert, Play, RefreshCw, ListMusic } from 'lucide-react-native';
import { cacheManager, musicApi, formatPlayCount, pickRandomBatch, type Song, type DiscoverPlaylist } from '@mplayer/core';
import SongRow from '../../components/SongRow';
import LoadingState from '../../components/LoadingState';
import ScalePress from '../../components/ScalePress';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import {radius, spacing, textVariants} from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

/** 猜你喜欢网格：16pt 页面沟槽（与节标题/发现页同轴线），列间 12；公式见 gridMetrics */
const cardW = gridCardWidth({ cols: 2 });
// 今日推荐一次拉取的大池子大小(每次随机抽 5 首,约 20 批不重复)
const RECOMMEND_POOL_SIZE = 100;

export default function RecommendPage() {
  const { colors } = useTheme();
  const animatedBg = useAnimatedBg();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  // 当前展示的随机批次 + 本轮已用过的池索引(抽完一轮自动重置)
  const [batch, setBatch] = useState<Song[]>([]);
  const [usedIndices, setUsedIndices] = useState<number[]>([]);
  // 早退/条件分支之后不得再调 hook，insets 必须在 LoadingState 早退前取
  const insets = useSafeAreaInsets();

  const load = useCallback(async (isRefresh: boolean) => {
    try {
      // 下拉刷新时清掉推荐缓存,拿最新数据
      if (isRefresh) cacheManager.clearByPrefix('personalized');
      const [songList, playlistList] = await Promise.all([
        // 一次拉大池子(100 首):推荐接口数据稳定,拉多首后本地随机抽 5 首/批展示
        musicApi.getRecommendedSongs(RECOMMEND_POOL_SIZE),
        musicApi.getRecommendedPlaylists(12),
      ]);
      setSongs(songList);
      setPlaylists(playlistList);
      const { batch: firstBatch, used } = pickRandomBatch(songList, [], 5);
      setBatch(firstBatch);
      setUsedIndices(used);
      setError(false);
    } catch (e: any) {
      console.error('[Recommend] load error:', e.message);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    playSong(songs[0]);
  };

  // 换一批:从大池子随机抽 5 首(本轮不重复,抽完一轮自动重置)
  const handleShuffle = () => {
    if (songs.length <= 5) return;
    const { batch: nextBatch, used } = pickRandomBatch(songs, usedIndices, 5);
    setBatch(nextBatch);
    setUsedIndices(used);
  };

  // 当前展示的 5 首(随机批次;池不足 5 首时直接展示整个池)
  const shownSongs = batch;

  if (loading) return <LoadingState />;

  return (
    <Animated.ScrollView
      style={[styles.container, { backgroundColor: animatedBg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topChromeHeight(insets.top), paddingBottom: bottomChromeHeight(insets.bottom, true) + SECTION_TAIL_PADDING },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          progressViewOffset={topChromeHeight(insets.top)}
        />
      }
    >
      {error && songs.length === 0 ? (
        <View style={styles.errorBox}>
          <CircleAlert size={40} color={colors.danger} />
          <Text style={styles.errorText}>加载失败，下拉重试</Text>
        </View>
      ) : (
        <>
          {/* 今日推荐 */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>今日推荐</Text>
              {songs.length > 0 && (
                <View style={styles.headerActions}>
                  <ScalePress onPress={handlePlayAll} style={styles.headerAction} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                    <Play size={15} color={colors.accent} />
                    <Text style={[styles.headerActionText, { color: colors.accent }]}>播放全部</Text>
                  </ScalePress>
                  <ScalePress onPress={handleShuffle} style={styles.headerAction} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                    <RefreshCw size={15} color={colors.textSecondary} />
                    <Text style={[styles.headerActionText, { color: colors.textSecondary }]}>换一批</Text>
                  </ScalePress>
                </View>
              )}
            </View>
            {shownSongs.length === 0 ? (
              <Text style={styles.emptyText}>暂无推荐歌曲</Text>
            ) : (
              shownSongs.map((s, i) => (
                <SongRow key={`${s.id}-${i}`} song={s} queueSongs={shownSongs} />
              ))
            )}
          </View>

          {/* 猜你喜欢 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>猜你喜欢</Text>
            {playlists.length === 0 ? (
              <Text style={styles.emptyText}>暂无推荐歌单</Text>
            ) : (
              <View style={styles.grid}>
                {playlists.map((p) => (
                  <TouchableOpacity
                    key={String(p.id)}
                    style={{ width: cardW }}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/discover-playlist/${p.id}` as any)}
                  >
                    {p.coverImgUrl ? (
                      <Image source={{ uri: p.coverImgUrl }} style={[styles.gridCover, { width: cardW, height: cardW }]} />
                    ) : (
                      <View style={[styles.gridCover, styles.gridCoverFallback]}>
                        <ListMusic size={32} color={colors.textDisabled} />
                      </View>
                    )}
                    <Text style={styles.gridName} numberOfLines={2}>{p.name}</Text>
                    <Text style={styles.gridMeta}>
                      {p.playCount ? formatPlayCount(p.playCount) : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </>
      )}
    </Animated.ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 主题切换平滑过渡（M3）：根部应用共享 Animated 背景色
  container: { flex: 1 },
  content: { paddingBottom: 32 },
  section: { paddingHorizontal: spacing[4], marginTop: spacing[4] },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    ...textVariants.sectionHeader,
    color: colors.textPrimary,
  },
  /* 头部动作：安静文字按钮（AM 式）——去底色去圆角，触控目标靠 padding + hitSlop */
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[1],
  },
  headerActionText: { ...textVariants.footnote, fontWeight: '600' },
  emptyText: { ...textVariants.footnote, color: colors.textSecondary, marginVertical: 20, textAlign: 'center' },
  errorBox: {
    alignItems: 'center',
    paddingTop: 80,
  },
  errorText: { ...textVariants.subhead, fontWeight: '400', color: colors.danger, marginTop: 10 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  gridCover: { borderRadius: radius.md, backgroundColor: colors.bgSurface },
  gridCoverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgHover,
  },
  gridName: {
    ...textVariants.footnote,
    fontWeight: '500',
    color: colors.textPrimary,
    marginTop: spacing[2],
  },
  gridMeta: {
    ...textVariants.micro,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: 2,
  },
});
