import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, RefreshControl, StyleSheet, Animated,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, SECTION_TAIL_PADDING } from '../../components/chromeMetrics';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import { gridCardWidth } from '../../components/gridMetrics';
import { GRID_CARD } from '../../components/gridCardMetrics';

import { CircleAlert, Play, RefreshCw, ListMusic, Music } from 'lucide-react-native';
import { cacheManager, getDirectClient, formatPlayCount, pickRandomBatch, type Song, type DiscoverPlaylist } from '@mplayer/core';
import SongRow from '../../components/SongRow';
import RecommendSkeleton from '../../components/RecommendSkeleton';
import LazyCover from '../../components/LazyCover';
import { RECOMMEND_BATCH_SIZE, RECOMMEND_GRID_COLS } from '../../components/recommendMetrics';
import { formatBatchMeta } from '../../components/recommendMeta';
import ScalePress, { pressScale } from '../../components/ScalePress';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { opacity, radius, spacing, textVariants } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

/** 猜你喜欢网格：16pt 页面沟槽（与节标题/发现页同轴线），列间 12；公式见 gridMetrics */
const cardW = gridCardWidth({ cols: RECOMMEND_GRID_COLS });
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
  // ADR-0008：首次播放前迷你播放栏隐藏，让位随之缩小
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));

  const load = useCallback(async (isRefresh: boolean) => {
    try {
      // 下拉刷新时清掉推荐缓存,拿最新数据
      if (isRefresh) cacheManager.clearByPrefix('personalized');
      const [songList, playlistList] = await Promise.all([
        // 一次拉大池子(100 首):推荐接口数据稳定,拉多首后本地随机抽 5 首/批展示
        getDirectClient('netease')!.getRecommendedSongs!(RECOMMEND_POOL_SIZE),
        getDirectClient('netease')!.getRecommendedPlaylists!(12),
      ]);
      setSongs(songList);
      setPlaylists(playlistList);
      const { batch: firstBatch, used } = pickRandomBatch(songList, [], RECOMMEND_BATCH_SIZE);
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

  // 当前展示的 5 首(随机批次;池不足 5 首时直接展示整个池)
  const shownSongs = batch;
  // 池子不超过一批时没有「换一批」的语义：禁用而不是点了没反应
  const canShuffle = songs.length > RECOMMEND_BATCH_SIZE;
  // 卡头封面叠放最多三张；batch 为空时退化为单个占位
  const stackSongs = shownSongs.slice(0, 3);

  const handlePlayAll = () => {
    // 只把**当前可见批次**入队：此前把 100 首随机池全塞进队列，用户以为「播放全部」只播 5 首，
    // 实际下一首会跳到池里从未展示过的歌。
    if (shownSongs.length === 0) return;
    usePlayerStore.getState().setQueue(shownSongs, 0);
    playSong(shownSongs[0]);
  };

  // 换一批:从大池子随机抽 5 首(本轮不重复,抽完一轮自动重置)
  const handleShuffle = () => {
    if (!canShuffle) return;
    const { batch: nextBatch, used } = pickRandomBatch(songs, usedIndices, RECOMMEND_BATCH_SIZE);
    setBatch(nextBatch);
    setUsedIndices(used);
  };

  // #186 #6：整页加载改为就地骨架，避免居中转圈→列表的布局跳动
  if (loading) return <RecommendSkeleton />;

  return (
    <Animated.ScrollView
      style={[styles.container, { backgroundColor: animatedBg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topChromeHeight(insets.top), paddingBottom: bottomChromeHeight(insets.bottom, true, playerVisible) + SECTION_TAIL_PADDING },
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
          {/* 每日推荐：5 首收进一张卡，卡头承担「今日推荐」标题与动作 */}
          <View style={styles.radioSection}>
            <View style={styles.radioCard}>
              <View style={styles.radioHeader}>
                <View
                  style={styles.coverStack}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {stackSongs.length > 0 ? stackSongs.map((song, i) => (
                    <View
                      key={`${song.id}-${i}`}
                      style={[
                        styles.stackSlot,
                        { left: i * 14, zIndex: stackSongs.length - i, transform: [{ rotate: `${(i - 1) * 6}deg` }] },
                      ]}
                    >
                      {song.cover ? (
                        <LazyCover uri={song.cover} style={styles.stackCover} />
                      ) : (
                        <View style={[styles.stackCover, styles.stackFallback]}>
                          <Music size={16} color={colors.textDisabled} />
                        </View>
                      )}
                    </View>
                  )) : (
                    <View style={[styles.stackCover, styles.stackFallback]}>
                      <Music size={16} color={colors.textDisabled} />
                    </View>
                  )}
                </View>
                <View style={styles.radioInfo}>
                  <Text style={styles.radioTitle}>每日推荐</Text>
                  <Text style={styles.radioMeta}>{formatBatchMeta(shownSongs)}</Text>
                </View>
              </View>

              <View style={styles.radioActions}>
                <ScalePress
                  onPress={handlePlayAll}
                  style={[styles.playAllBtn, shownSongs.length === 0 && { opacity: opacity.disabled }]}
                  disabled={shownSongs.length === 0}
                  accessibilityLabel="播放全部（当前推荐）"
                  accessibilityState={{ disabled: shownSongs.length === 0 }}
                >
                  <Play size={14} color={colors.textInverse} fill={colors.textInverse} />
                  <Text style={styles.playAllText}>播放全部</Text>
                </ScalePress>
                <ScalePress
                  onPress={handleShuffle}
                  style={[styles.shuffleBtn, !canShuffle && { opacity: opacity.disabled }]}
                  disabled={!canShuffle}
                  accessibilityLabel="换一批推荐"
                  accessibilityState={{ disabled: !canShuffle }}
                >
                  <RefreshCw size={14} color={canShuffle ? colors.textSecondary : colors.textDisabled} />
                  <Text style={[styles.shuffleText, { color: canShuffle ? colors.textSecondary : colors.textDisabled }]}>换一批</Text>
                </ScalePress>
              </View>

              {shownSongs.length === 0 ? (
                <Text style={styles.emptyText}>暂无推荐歌曲</Text>
              ) : (
                <View style={styles.radioRows}>
                  {shownSongs.map((s, i) => (
                    <SongRow key={`${s.id}-${i}`} song={s} queueSongs={shownSongs} />
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* 猜你喜欢：两列网格，纵向浏览符合列表直觉 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>猜你喜欢</Text>
            {playlists.length === 0 ? (
              <Text style={styles.emptyText}>暂无推荐歌单</Text>
            ) : (
              <View style={styles.grid}>
                {playlists.map((p) => (
                  <ScalePress
                    key={String(p.id)}
                    style={{ width: cardW }}
                    pressScaleTo={pressScale.row}
                    onPress={() => router.push(`/discover-playlist/${p.id}` as any)}
                    accessibilityLabel={`${p.name}，歌单`}
                  >
                    {p.coverImgUrl ? (
                      <LazyCover uri={p.coverImgUrl} style={[styles.gridCover, { width: cardW, height: cardW }]} />
                    ) : (
                      <View style={[styles.gridCover, styles.gridCoverFallback, { width: cardW, height: cardW }]}>
                        <ListMusic size={32} color={colors.textDisabled} />
                      </View>
                    )}
                    <Text style={styles.gridName} numberOfLines={2}>{p.name}</Text>
                    <Text style={styles.gridMeta}>
                      {p.playCount ? formatPlayCount(p.playCount) : ''}
                    </Text>
                  </ScalePress>
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
  content: { paddingBottom: spacing[8] },
  section: { paddingHorizontal: spacing[4], marginTop: spacing[6] },
  sectionTitle: {
    ...textVariants.sectionHeader,
    color: colors.textPrimary,
    marginBottom: spacing[3],
  },
  emptyText: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[5],
    textAlign: 'center',
  },
  errorBox: {
    alignItems: 'center',
    paddingTop: 80,
  },
  errorText: { ...textVariants.subhead, fontWeight: '400', color: colors.dangerText, marginTop: spacing[3] },
  // 每日推荐卡
  radioSection: { paddingHorizontal: spacing[4], marginTop: spacing[4] },
  radioCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  radioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
  },
  coverStack: { width: 78, height: 52, marginRight: spacing[3] },
  stackSlot: { position: 'absolute', top: 3 },
  stackCover: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bgSurface,
    backgroundColor: colors.bgHover,
  },
  stackFallback: { alignItems: 'center', justifyContent: 'center' },
  radioInfo: { flex: 1 },
  radioTitle: { ...textVariants.title, color: colors.textPrimary },
  radioMeta: { ...textVariants.footnote, color: colors.textSecondary, marginTop: 2 },
  radioActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  playAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    minHeight: 32,
    paddingVertical: 6,
  },
  playAllText: { ...textVariants.footnote, fontWeight: '600', color: colors.textInverse },
  shuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: 6,
    paddingHorizontal: spacing[1],
  },
  shuffleText: { ...textVariants.footnote, fontWeight: '500' },
  radioRows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  // 猜你喜欢两列网格（度量与 RecommendSkeleton 同源）
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  gridCover: { borderRadius: GRID_CARD.coverRadius, backgroundColor: colors.bgSurface },
  gridCoverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgHover,
  },
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
});
