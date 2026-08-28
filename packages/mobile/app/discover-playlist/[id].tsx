import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getDirectClient, formatPlayCount, type Song } from '@mplayer/core';
import type { DiscoverPlaylist } from '@mplayer/core';
import SongListSkeleton from '../../components/SongListSkeleton';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import SongRow from '../../components/SongRow';
import CollapsingHero from '../../components/CollapsingHero';
import { probeSongsPrefetch } from '../../services/songProbe';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { textVariants } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

const PAGE_SIZE = 50;

export default function DiscoverPlaylistDetailPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<DiscoverPlaylist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    offsetRef.current = 0;
    (async () => {
      try {
        // 元数据与第一页歌曲并行（weapi 直连，歌曲含已解析播放 URL）
        const [p, page] = await Promise.all([
          getDirectClient('netease')!.getPlaylistDetail!(Number(id)),
          getDirectClient('netease')!.getPlaylistSongs!(Number(id), 0, PAGE_SIZE),
        ]);
        if (cancelled) return;
        setPlaylist(p);
        setSongs(page.songs);
        setHasMore(page.songs.length < page.total);
        offsetRef.current = PAGE_SIZE;
        // 后台补齐缺失 URL（weapi by-ID 批量直链），完成后触发重渲染
        // URL 补齐后直连探测：直链写入 core 预取缓存（播放 0 等待秒播）；
        // 探测不再写列表徽标（预测常错，徽标改播放后回写）
        void getDirectClient('netease')!.resolvePlayableUrls!(page.songs).then(() => {
          if (!cancelled) {
            setSongs([...page.songs]);
            void probeSongsPrefetch(page.songs);
          }
        });
      } catch (e: any) {
        console.error('[DiscoverPlaylistDetail] load error:', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !id) return;
    setLoadingMore(true);
    try {
      const page = await getDirectClient('netease')!.getPlaylistSongs!(Number(id), offsetRef.current, PAGE_SIZE);
      if (page.songs.length > 0) {
        setSongs(prev => [...prev, ...page.songs]);
        offsetRef.current += PAGE_SIZE;
        setHasMore(offsetRef.current < page.total);
        // 后台补齐本页缺失 URL + 补齐后直连探测预取（同首屏）
        void getDirectClient('netease')!.resolvePlayableUrls!(page.songs).then(() => {
          setSongs(prev => [...prev]);
          void probeSongsPrefetch(page.songs);
        });
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[DiscoverPlaylistDetail] loadMore error:', e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) return <SongListSkeleton />;
  if (!playlist) {
    return (
      <View style={styles.empty}>
        <Stack.Screen
          options={{
            title: '歌单详情',
            headerShown: true,
            headerStyle: { backgroundColor: colors.bgSurface },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
          }}
        />
        <Text style={{ ...textVariants.callout, color: colors.textSecondary }}>歌单不存在</Text>
      </View>
    );
  }

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    playSong(songs[0]);
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        <Stack.Screen options={{ title: playlist.name, headerShown: false }} />
        <CollapsingHero
          cover={playlist.coverImgUrl}
          navTitle={playlist.name}
          title={playlist.name}
          subtitle={playlist.creator?.nickname ?? '未知'}
          meta={`播放: ${formatPlayCount(playlist.playCount)} · 歌曲: ${playlist.trackCount}首`}
          tags={playlist.tags}
          actionLabel="播放全部"
          onAction={handlePlayAll}
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          renderItem={({ item }) => (
            <SongRow
              song={item}
              showSource
              queueSongs={songs}
              onSwap={(original, swapped) =>
                setSongs((prev) => prev.map((s) => (s.id === original.id ? swapped : s)))
              }
            />
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={songs.length > 0} />}
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  empty: { flex: 1, backgroundColor: colors.bgBase, justifyContent: 'center', alignItems: 'center' },
});
