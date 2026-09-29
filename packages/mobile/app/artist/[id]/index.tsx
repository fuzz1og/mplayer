/**
 * 歌手页（#417）。三处根因各自修法：
 * ① 专辑不再截断到 20 张：横滑条只做**预览**（首屏 limit=100），分区标题右侧的「更多」进
 *    `albums` 时间线页（按年份分区、纵向滚动看全部，久石让 243 张也能看完）；
 * ② 头像/名字不再按名字搜第一条：首屏直接用入口带来的 name/pic 渲染（零请求秒出），
 *    随后按 id 走 `getArtistInfoRouted` 校正（网易同名多实体「陶喆」5196 / 31213543 不再串号）；
 * ③ 专辑抓取失败不再静默成「暂无专辑」：core 给了 `ok`，失败走「加载失败，点此重试」。
 *
 * 另：首屏不再被 loading 早退挡住——Hero 常驻（骨架期也有返回按钮），列表区给行骨架。
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList,
} from 'react-native';
import ScalePress from '../../../components/ScalePress';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { ChevronRight, Disc3 } from 'lucide-react-native';
import { getArtistInfoRouted, getDirectClient, type Artist, type Song, type Album } from '@mplayer/core';
import SongListSkeleton from '../../../components/SongListSkeleton';
import LoadMoreFooter from '../../../components/LoadMoreFooter';
import SongRow from '../../../components/SongRow';
import CollapsingHero from '../../../components/CollapsingHero';
import LazyCover from '../../../components/LazyCover';
import BottomSafePlayerBar from '../../../components/BottomSafePlayerBar';
import { usePlayerStore } from '../../../stores/playerStore';
import { playSong } from '../../../services/audioPlayer';
import { replaceSongInList } from '../../../services/songListOps';
import { radius, shadow, spacing, textVariants, typography } from '../../../theme/tokens';
import type { ThemeColors } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';

/**
 * 专辑分区首屏页大小（#417：社区口径 lx-music 默认 100；core 自控上限 1000）。
 *
 * 这是**数据**页大小，不是「一次挂 100 张封面」的许可（#496）：横滑条已是横向
 * `FlatList`（窗口 3 屏），封面统一过 `LazyCover` 的在飞闸门。
 */
const ALBUM_PAGE_SIZE = 100;

/** 横滑条 keyExtractor（模块级，不随渲染新建） */
const albumKey = (a: Album) => a.id;

export default function ArtistDetailPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, name, pic } = useLocalSearchParams<{ id: string; name?: string; pic?: string }>();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songTotal, setSongTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumsTotal, setAlbumsTotal] = useState<number | null>(null);
  const [albumsError, setAlbumsError] = useState(false);
  const [albumReloadKey, setAlbumReloadKey] = useState(0);

  // 入口带来的名字/头像先出（零请求），按 id 校正后再覆盖
  const displayName = artist?.name || name || '歌手';
  const displayPic = artist?.picUrl || pic || '';

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !id) return;
    setLoadingMore(true);
    try {
      const r = await getDirectClient('netease')!.getArtistSongs!(id, songs.length, 50);
      if (r.songs.length > 0) {
        setSongs(prev => [...prev, ...r.songs]);
        setHasMore(songs.length + r.songs.length < r.total);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error('[ArtistDetail] loadMore error:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, id, songs.length]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // 歌手信息按 id 校正（失败保留入口参数，不退化成「未知歌手」）
      void getArtistInfoRouted('netease', id).then((info) => {
        if (!cancelled && info) setArtist(info);
      });
      try {
        const songResult = await getDirectClient('netease')!.getArtistSongs!(id, 0, 50);
        if (cancelled) return;
        setSongs(songResult.songs);
        setSongTotal(songResult.total);
        setHasMore(songResult.songs.length < songResult.total);
      } catch (e) {
        console.error('[ArtistDetail] load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // 专辑分区：只取**首屏一页**做预览；全量在同目录的 albums 时间线页里按 `more` 续页（#417 ①）
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setAlbumsError(false);
    getDirectClient('netease')!.getArtistAlbums!(id, 0, ALBUM_PAGE_SIZE)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) { setAlbumsError(true); return; }
        setAlbums(r.albums);
        setAlbumsTotal(r.total);
      })
      .catch((e) => { if (!cancelled) { console.error('[ArtistDetail] albums error:', e); setAlbumsError(true); } });
    return () => { cancelled = true; };
  }, [id, albumReloadKey]);

  // 「查看全部专辑」（#417 P0.1）：时间线页按年份分区 + 纵向滚动看全部，横滑条放不下 243 张
  const openAllAlbums = useCallback(() => {
    if (!id) return;
    router.push(`/artist/${id}/albums?name=${encodeURIComponent(displayName)}` as any);
  }, [id, displayName]);

  // 单曲换源后更新列表（SongRow 更多菜单触发；不更新会显示旧的源条目）。
  // useCallback（#411）：SongRow 的 prop，引用必须稳定（函数式更新 → 零依赖）。
  const handleSwap = useCallback((original: Song, swapped: Song) => {
    setSongs((prev) => replaceSongInList(prev, original.id, swapped));
  }, []);

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    playSong(songs[0]);
  };

  const renderItem = useCallback(
    ({ item }: { item: Song }) => (
      <SongRow song={item} showSource queueSongs={songs} onSwap={handleSwap} />
    ),
    [songs, handleSwap],
  );

  const renderAlbumCard = useCallback(
    ({ item: a }: { item: Album }) => (
      <ScalePress
        style={styles.albumCard}
        onPress={() => router.push(`/album/${a.id}?name=${encodeURIComponent(a.name)}&pic=${encodeURIComponent(a.picUrl)}&artist=${encodeURIComponent(a.artist)}&source=netease` as any)}
      >
        {a.picUrl ? (
          <LazyCover uri={a.picUrl} style={styles.albumCover} />
        ) : (
          <View style={[styles.albumCover, styles.albumCoverFallback]}>
            <Disc3 size={24} color={colors.textTertiary} />
          </View>
        )}
        <Text style={styles.albumName} numberOfLines={1}>{a.name}</Text>
      </ScalePress>
    ),
    [styles, colors.textTertiary],
  );

  const albumsHeader = (
    <View style={styles.albumsSection}>
      <View style={styles.albumsTitleRow}>
        <Text style={styles.albumsTitle}>
          {albumsTotal !== null ? `专辑 · ${albumsTotal} 张` : albums.length > 0 ? `专辑 · 已加载 ${albums.length} 张` : '专辑'}
        </Text>
        {albums.length > 0 ? (
          <ScalePress style={styles.albumsMore} onPress={openAllAlbums} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.albumsMoreText}>更多</Text>
            <ChevronRight size={16} color={colors.textTertiary} />
          </ScalePress>
        ) : null}
      </View>
      {albumsError ? (
        <ScalePress style={styles.albumsRetry} onPress={() => setAlbumReloadKey(k => k + 1)}>
          <Text style={styles.albumsRetryText}>加载失败，点此重试</Text>
        </ScalePress>
      ) : albums.length === 0 ? null : (
        // 横向 FlatList：只挂可视窗口附近的卡，不再一次把 100 张全挂上（#496）。
        // 不能给 getItemLayout —— 卡片高度随字号/主题变，算错比不给更糟。
        <FlatList
          horizontal
          data={albums}
          keyExtractor={albumKey}
          renderItem={renderAlbumCard}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={3}
        />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView edges={[]} style={styles.flex}>
        <Stack.Screen options={{ title: displayName, headerShown: false }} />
        <CollapsingHero
          cover={displayPic || undefined}
          fallbackIcon={
            <Text style={styles.avatarFallback}>{(displayName || '?')[0]}</Text>
          }
          navTitle={displayName}
          title={displayName}
          subtitle={songTotal > 0 ? `共 ${songTotal} 首歌曲` : undefined}
          actionLabel="播放全部"
          onAction={handlePlayAll}
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={songs.length > 0} />}
          ListEmptyComponent={
            loading ? (
              <SongListSkeleton rows={6} showSource />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>暂无歌曲</Text>
              </View>
            )
          }
          listHeader={id ? albumsHeader : null}
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  flex: { flex: 1 },
  albumsSection: { paddingTop: spacing[3], paddingBottom: spacing[2], paddingLeft: spacing[4] },
  albumsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing[4],
    marginBottom: spacing[3],
  },
  albumsTitle: { ...textVariants.body, fontWeight: typography.weights.semibold, color: colors.textPrimary },
  albumsMore: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  albumsMoreText: { ...textVariants.footnote, color: colors.textTertiary },
  albumsRetry: {
    alignSelf: 'flex-start',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    backgroundColor: colors.bgSurface,
  },
  albumsRetryText: { ...textVariants.footnote, color: colors.textSecondary },
  albumCard: {
    width: 116,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    ...shadow.sm,
    padding: spacing[2],
    marginRight: spacing[3],
  },
  albumCover: { width: 100, height: 100, borderRadius: radius.sm, backgroundColor: colors.bgHover },
  albumCoverFallback: { justifyContent: 'center', alignItems: 'center' },
  albumName: { ...textVariants.caption, color: colors.textTertiary, marginTop: 6 },
  avatarFallback: { color: colors.textInverse, fontSize: 56, fontWeight: typography.weights.bold },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { ...textVariants.callout, color: colors.textSecondary },
});
