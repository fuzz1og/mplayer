import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Disc3 } from 'lucide-react-native';
import { musicApi, type Song, type Album } from '@mplayer/core';
import SongListSkeleton from '../../components/SongListSkeleton';
import SongRow from '../../components/SongRow';
import CollapsingHero from '../../components/CollapsingHero';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { probeSongsPrefetch } from '../../services/songProbe';
import { textVariants } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export default function AlbumDetailPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, name, pic, artist } = useLocalSearchParams<{ id: string; name?: string; pic?: string; artist?: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  const displayName = album?.name || name || '专辑';
  const displayPic = album?.picUrl || pic || '';
  const displayArtist = album?.artist || artist || '';

  useEffect(() => {
    // 缺 id（畸形链接）不能卡在 LoadingState：直接结束加载态渲染空列表
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await musicApi.getAlbumDetail(id);
        if (cancelled) return;
        if (r) {
          setAlbum(r.album);
          setSongs(r.songs);
          // 后台补齐缺失 URL（weapi by-ID 批量直链），完成后触发重渲染
          void musicApi.resolveNeteaseSongUrls(r.songs).then(() => {
            if (cancelled) return;
            setSongs([...r.songs]);
            // URL 补齐后直连探测：直链写入 core 预取缓存（播放 0 等待秒播）；
            // 探测不再写列表徽标（预测常错，徽标改播放后回写）
            void probeSongsPrefetch(r.songs);
          });
        }
      } catch (e: any) {
        console.error('[AlbumDetail] load error:', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    playSong(songs[0]);
  };

  // 单曲换源后更新列表（SongRow 更多菜单触发）
  const handleSwap = (original: Song, swapped: Song) => {
    setSongs((prev) => prev.map((s) => (s.id === original.id ? swapped : s)));
  };

  const year = (() => {
    const t = Number(album?.publishTime || 0);
    return t > 0 ? String(new Date(t).getFullYear()) : '';
  })();

  if (loading) return <SongListSkeleton />;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        <Stack.Screen options={{ title: displayName, headerShown: false }} />
        <CollapsingHero
          cover={displayPic}
          fallbackIcon={<Disc3 size={72} color={colors.textInverse} />}
          navTitle={displayName}
          title={displayName}
          subtitle={displayArtist || undefined}
          meta={year ? `${year} · ${songs.length} 首` : `${songs.length} 首`}
          actionLabel="播放全部"
          onAction={handlePlayAll}
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          renderItem={({ item }) => (
            <SongRow song={item} showSource queueSongs={songs} onSwap={handleSwap} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ ...textVariants.callout, color: colors.textSecondary }}>暂无歌曲</Text>
            </View>
          }
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  empty: { paddingVertical: 60, alignItems: 'center' },
});
