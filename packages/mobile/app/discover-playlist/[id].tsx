import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { musicApi, formatPlayCount, type Song } from '@mplayer/core';
import type { DiscoverPlaylist } from '@mplayer/core';
import LoadingState from '../../components/LoadingState';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import SongRow from '../../components/SongRow';
import CollapsingHero from '../../components/CollapsingHero';
import { probeSongsWithTags } from '../../services/songProbe';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
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
        // 跳过逐首搜索兜底(慢):先秒显列表,后台批量补齐 URL 后更新
        const [p, page] = await Promise.all([
          musicApi.getNeteasePlaylistDetail(Number(id)),
          musicApi.getNeteasePlaylistSongsPage(Number(id), 0, PAGE_SIZE, true),
        ]);
        if (cancelled) return;
        setPlaylist(p);
        setSongs(page.songs);
        setHasMore(page.songs.length < page.total);
        offsetRef.current = PAGE_SIZE;
        // 后台补齐缺失 URL(weapi 批量 + 10 并发搜索兜底),完成后触发重渲染
        // URL 补齐后再探测：搜索兜底拿到的歌此时才有 url，提前探测会被
        // core 的 fail-open 判成 valid（无版权歌永远不出现「无效」徽标）
        void musicApi.resolveNeteaseSongUrls(page.songs, false).then(() => {
          if (!cancelled) {
            setSongs([...page.songs]);
            void probeSongsWithTags(page.songs, { missingAsInvalid: true });
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
      const page = await musicApi.getNeteasePlaylistSongsPage(Number(id), offsetRef.current, PAGE_SIZE, true);
      if (page.songs.length > 0) {
        setSongs(prev => [...prev, ...page.songs]);
        offsetRef.current += PAGE_SIZE;
        setHasMore(offsetRef.current < page.total);
        // 后台补齐本页缺失 URL + 补齐后再探测（同首屏）
        void musicApi.resolveNeteaseSongUrls(page.songs, false).then(() => {
          setSongs(prev => [...prev]);
          void probeSongsWithTags(page.songs, { missingAsInvalid: true });
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

  if (loading) return <LoadingState />;
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
        <Text style={{ color: colors.textSecondary, fontSize: 16 }}>歌单不存在</Text>
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
