import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Disc3 } from 'lucide-react-native';
import { musicApi, type Song, type Album } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import SongRow from '../../components/SongRow';
import CollapsingHero from '../../components/CollapsingHero';
import { probeSongsWithTags } from '../../services/songProbe';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { radius, shadow, spacing } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export default function ArtistDetailPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, name, pic } = useLocalSearchParams<{ id: string; name?: string; pic?: string }>();
  const [artist, setArtist] = useState<any>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const songTotalRef = useRef(0);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !id) return;
    setLoadingMore(true);
    try {
      const r = await musicApi.getNeteaseArtistSongs(id as string, songs.length, 50);
      if (r.songs.length > 0) {
        setSongs(prev => [...prev, ...r.songs]);
        setHasMore(songs.length + r.songs.length < r.total);
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[ArtistDetail] loadMore error:', e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, id, songs.length]);

  useEffect(() => {
    // 缺 id（畸形链接）不能卡在 LoadingState：直接结束加载态渲染空列表
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const artistName = name || id;
        const [artistResults, songResult] = await Promise.all([
          musicApi.searchNeteaseArtists(artistName, 1),
          musicApi.getNeteaseArtistSongs(id as string, 0, 50),
        ]);
        if (cancelled) return;
        setSongs(songResult.songs);
        songTotalRef.current = songResult.total;
        setHasMore(songResult.songs.length < songResult.total);
        const info = artistResults[0] || null;
        // 优先用入口传入的 weapi 高清头像（searchNeteaseArtists 结果兜底）
        setArtist({ ...info, name: info?.name || artistName, picUrl: pic || info?.picUrl || '' });
        // 补齐缺失 URL 后探测:30 秒片段自动标「短时长」徽标
        void musicApi.resolveNeteaseSongUrls(songResult.songs, false).then(() => {
          if (!cancelled) probeSongsWithTags(songResult.songs, { missingAsInvalid: true });
        });
      } catch (e: any) {
        console.error('[ArtistDetail] load error:', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, name]);

  // 专辑区块:前 20 张,横向滚动
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    musicApi.getArtistAlbums(id as string, 0, 20)
      .then(r => { if (!cancelled) setAlbums(r.albums); })
      .catch((e: any) => console.error('[ArtistDetail] albums error:', e.message));
    return () => { cancelled = true; };
  }, [id]);

  // 单曲换源后更新列表（SongRow 更多菜单触发；不更新会显示旧的源条目）
  const handleSwap = (original: Song, swapped: Song) => {
    setSongs((prev) => prev.map((s) => (s.id === original.id ? swapped : s)));
  };

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    playSong(songs[0]);
  };

  if (loading) return <LoadingState />;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        <Stack.Screen options={{ title: artist?.name || '歌手', headerShown: false }} />
        <CollapsingHero
          cover={artist?.picUrl}
          fallbackIcon={
            <Text style={{ color: colors.textInverse, fontSize: 56, fontWeight: '700' }}>
              {(artist?.name || '?')[0]}
            </Text>
          }
          navTitle={artist?.name || '歌手'}
          title={artist?.name || '未知歌手'}
          subtitle={songTotalRef.current > 0 ? `共 ${songTotalRef.current} 首歌曲` : undefined}
          actionLabel="播放全部"
          onAction={handlePlayAll}
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          renderItem={({ item }) => <SongRow song={item} showSource queueSongs={songs} onSwap={handleSwap} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={songs.length > 0} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: colors.textSecondary, fontSize: 16 }}>暂无歌曲</Text>
            </View>
          }
          listHeader={
            albums.length > 0 ? (
              <View style={styles.albumsSection}>
                <Text style={styles.albumsTitle}>专辑</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {albums.map(a => (
                    <TouchableOpacity
                      key={a.id}
                      style={styles.albumCard}
                      activeOpacity={0.7}
                      onPress={() => router.push(`/album/${a.id}?name=${encodeURIComponent(a.name)}&pic=${encodeURIComponent(a.picUrl)}&artist=${encodeURIComponent(a.artist)}` as any)}
                    >
                      {a.picUrl ? (
                        <Image source={{ uri: a.picUrl }} style={styles.albumCover} />
                      ) : (
                        <View style={[styles.albumCover, { backgroundColor: colors.bgHover, justifyContent: 'center', alignItems: 'center' }]}>
                          <Disc3 size={24} color={colors.textTertiary} />
                        </View>
                      )}
                      <Text style={styles.albumName} numberOfLines={1}>{a.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  albumsSection: { paddingTop: spacing[3], paddingBottom: spacing[2], paddingLeft: spacing[4] },
  albumsTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: spacing[3] },
  albumCard: {
    width: 116,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    ...shadow.sm,
    padding: spacing[2],
    marginRight: spacing[3],
  },
  albumCover: { width: 100, height: 100, borderRadius: radius.sm, backgroundColor: colors.bgHover },
  albumName: { color: colors.textTertiary, fontSize: 12, marginTop: 6 },
  empty: { paddingVertical: 60, alignItems: 'center' },
});
