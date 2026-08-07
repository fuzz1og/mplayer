import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity, Image, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { cacheManager, musicApi, formatPlayCount, pickRandomBatch, type Song, type DiscoverPlaylist } from '@mplayer/core';
import SongRow from '../../components/SongRow';
import LoadingState from '../../components/LoadingState';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 10;
const CARD_COLS = 2;
const cardW = (SCREEN_WIDTH - 12 * 2 - CARD_GAP) / CARD_COLS;
// 今日推荐一次拉取的大池子大小(每次随机抽 5 首,约 20 批不重复)
const RECOMMEND_POOL_SIZE = 100;

export default function RecommendPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  // 当前展示的随机批次 + 本轮已用过的池索引(抽完一轮自动重置)
  const [batch, setBatch] = useState<Song[]>([]);
  const [usedIndices, setUsedIndices] = useState<number[]>([]);

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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e74c3c" />}
    >
      {error && songs.length === 0 ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={40} color="#e74c3c" />
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
                      <Ionicons name="play" size={14} color="#fff" />
                      <Text style={styles.playAllText}>播放全部</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.shuffleBtn} onPress={handleShuffle} activeOpacity={0.8}>
                      <Ionicons name="refresh" size={14} color="#e74c3c" />
                      <Text style={styles.shuffleText}>换一批</Text>
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
                        <Ionicons name="list-outline" size={32} color="#555" />
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
  container: { flex: 1, backgroundColor: '#1a1a2e' },
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  playAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e74c3c',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 8,
  },
  playAllText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  shuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2a2a4a',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 8,
  },
  shuffleText: { color: '#e74c3c', fontSize: 12, fontWeight: '600' },
  emptyText: { color: '#666', fontSize: 13, marginVertical: 20, textAlign: 'center' },
  errorBox: {
    alignItems: 'center',
    paddingTop: 80,
  },
  errorText: { color: '#e74c3c', fontSize: 14, marginTop: 10 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
  },
  gridCard: { marginBottom: 4 },
  gridCover: { borderRadius: 10, backgroundColor: '#16213e' },
  gridCoverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2a2a4a',
  },
  gridName: {
    color: '#fff',
    fontSize: 13,
    marginTop: 6,
  },
  gridMeta: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
});
