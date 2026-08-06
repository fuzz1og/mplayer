import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity, Image, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { CircleAlert, Play, RefreshCw, ListMusic } from 'lucide-react-native';
import { cacheManager, musicApi, formatPlayCount, type Song, type DiscoverPlaylist } from '@mplayer/core';
import SongRow from '../../components/SongRow';
import LoadingState from '../../components/LoadingState';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { colors, radius } from '../../theme/tokens';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 10;
const CARD_COLS = 2;
const cardW = (SCREEN_WIDTH - 12 * 2 - CARD_GAP) / CARD_COLS;
// 今日推荐一次拉取的大池子大小(5 首/批,共 20 批,轮完才重新拉取)
const RECOMMEND_POOL_SIZE = 100;

export default function RecommendPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [error, setError] = useState(false);
  const [songOffset, setSongOffset] = useState(0);

  const load = useCallback(async (isRefresh: boolean) => {
    try {
      // 下拉刷新时清掉推荐缓存,拿最新数据
      if (isRefresh) cacheManager.clearByPrefix('personalized');
      const [songList, playlistList] = await Promise.all([
        // 一次拉大池子(100 首):推荐接口数据稳定,拉多首后本地按 5 首/批慢慢换
        musicApi.getRecommendedSongs(RECOMMEND_POOL_SIZE),
        musicApi.getRecommendedPlaylists(12),
      ]);
      setSongs(songList);
      setPlaylists(playlistList);
      setSongOffset(0);
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

  // 换一批:5 首/批轮换,一次拉的大池子(100 首)够 20 批,轮完才重新拉取
  // 池耗尽重新拉取时给按钮反馈（否则静默失败/无感知等待）
  const handleShuffle = () => {
    if (songs.length <= 5) return;
    if (songOffset + 5 >= songs.length) {
      setShuffling(true);
      load(false).finally(() => setShuffling(false));
      return;
    }
    setSongOffset(prev => prev + 5);
  };

  // 当前展示的 5 首(循环取)
  const shownSongs = songs.length > 5
    ? Array.from({ length: 5 }, (_, i) => songs[(songOffset + i) % songs.length])
    : songs;

  if (loading) return <LoadingState />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
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
              <View style={styles.headerActions}>
                {songs.length > 0 && (
                  <>
                    <TouchableOpacity style={styles.playAllBtn} onPress={handlePlayAll} activeOpacity={0.8}>
                      <Play size={14} color={colors.textInverse} />
                      <Text style={styles.playAllText}>播放全部</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.shuffleBtn} onPress={handleShuffle} activeOpacity={0.8} disabled={shuffling}>
                      <RefreshCw size={14} color={colors.accent} />
                      <Text style={styles.shuffleText}>{shuffling ? '加载中…' : '换一批'}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
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
                    style={[styles.gridCard, { width: cardW }]}
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
                    <Text style={styles.gridName} numberOfLines={1}>{p.name}</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingBottom: 32 },
  section: { paddingHorizontal: 12, marginTop: 16 },
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
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  playAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 8,
  },
  playAllText: { color: colors.textInverse, fontSize: 12, fontWeight: '600' },
  shuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgHover,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 8,
  },
  shuffleText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  emptyText: { color: colors.textSecondary, fontSize: 13, marginVertical: 20, textAlign: 'center' },
  errorBox: {
    alignItems: 'center',
    paddingTop: 80,
  },
  errorText: { color: colors.danger, fontSize: 14, marginTop: 10 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
  },
  gridCard: { marginBottom: 4 },
  gridCover: { borderRadius: radius.md, backgroundColor: colors.bgSurface },
  gridCoverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgHover,
  },
  gridName: {
    color: colors.textPrimary,
    fontSize: 13,
    marginTop: 6,
  },
  gridMeta: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
});
