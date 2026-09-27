/**
 * 歌手的全部专辑（#417 P0.1「查看全部专辑」入口的目标页）。
 *
 * 形态：**按发行年份的时间线**——每年一个年份头 + 该年的专辑网格（3 列），
 * 纵向滚动按 `more` 续页，因此久石让那类 243 张也能一屏一屏地看完。
 * 横滑条承载不了这个量级，所以入口从歌手页的「专辑」分区标题右侧进来。
 *
 * 四态齐备：加载（网格骨架，与真实网格同形，见 #416 纪律）/ 成功 / 失败（可重试）/ 空。
 * 数据面走 core `getArtistAlbums`，失败由 `ok === false` 表达（#417 ③）——不再静默成空态。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Disc3, ImageOff } from 'lucide-react-native';
import { getDirectClient, type Album } from '@mplayer/core';
import EmptyState from '../../../components/EmptyState';
import ScalePress from '../../../components/ScalePress';
import CoverGridSkeleton from '../../../components/CoverGridSkeleton';
import { GRID_CARD } from '../../../components/gridCardMetrics';
import { GRID_GAP, gridCardWidth } from '../../../components/gridMetrics';
import {
  ALBUM_TIMELINE_COLS,
  buildAlbumTimeline,
  type AlbumTimelineItem,
} from '../../../components/albumTimeline';
import { radius, spacing, textVariants, typography } from '../../../theme/tokens';
import type { ThemeColors } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';

/** 每页张数（core 自控上限 1000；100 是社区口径，也是久石让 243 张的 3 页） */
const PAGE_SIZE = 100;
const CARD_W = gridCardWidth({ cols: ALBUM_TIMELINE_COLS });

export default function ArtistAlbumsPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const displayName = name || '歌手';

  const [albums, setAlbums] = useState<Album[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadPage = useCallback(async (offset: number): Promise<boolean> => {
    if (!id) return false;
    const res = await getDirectClient('netease')!.getArtistAlbums!(id, offset, PAGE_SIZE);
    if (!res.ok) return false;
    setAlbums((prev) => (offset === 0 ? res.albums : [...prev, ...res.albums]));
    setTotal(res.total);
    setMore(res.more);
    return true;
  }, [id]);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    // 换歌手/重试都要从第一页重来，否则会拼上前一个歌手的专辑
    setAlbums([]);
    setTotal(null);
    setMore(false);
    loadPage(0)
      .then((ok) => { if (!cancelled && !ok) setFailed(true); })
      .catch((e) => { if (!cancelled) { console.error('[ArtistAlbums] load error:', e); setFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, reloadKey, loadPage]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !more) return;
    setLoadingMore(true);
    try {
      const ok = await loadPage(albums.length);
      if (!ok) setFailed(true);
    } catch (e) {
      console.error('[ArtistAlbums] loadMore error:', e);
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, more, loadPage, albums.length]);

  const items = useMemo(() => buildAlbumTimeline(albums), [albums]);

  const openAlbum = useCallback((album: Album) => {
    router.push(
      `/album/${album.id}?name=${encodeURIComponent(album.name)}&pic=${encodeURIComponent(album.picUrl)}&artist=${encodeURIComponent(album.artist)}&source=netease` as any,
    );
  }, []);

  const renderItem = useCallback(({ item }: { item: AlbumTimelineItem }) => {
    if (item.kind === 'year') {
      return (
        <View style={styles.yearHeader}>
          <Text style={styles.yearText}>{item.year}</Text>
          <Text style={styles.yearCount}>{item.count} 张</Text>
        </View>
      );
    }
    return (
      <View style={styles.row}>
        {item.albums.map((album) => (
          <ScalePress key={album.id} style={styles.card} onPress={() => openAlbum(album)}>
            {album.picUrl ? (
              <Image source={{ uri: album.picUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverFallback]}>
                <Disc3 size={28} color={colors.textTertiary} />
              </View>
            )}
            <Text style={styles.cardName} numberOfLines={2}>{album.name}</Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {album.trackCount ? `${album.trackCount} 首` : album.subType || ' '}
            </Text>
          </ScalePress>
        ))}
      </View>
    );
  }, [colors.textTertiary, openAlbum, styles]);

  const header = (
    <Stack.Screen
      options={{
        title: `${displayName}的专辑`,
        headerShown: true,
        headerStyle: { backgroundColor: colors.bgBase },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
      }}
    />
  );

  if (!id) {
    return (
      <View style={styles.container}>
        {header}
        <EmptyState icon={ImageOff} title="找不到这位歌手" subtitle="链接里缺少歌手 id" />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <CoverGridSkeleton columns={ALBUM_TIMELINE_COLS} rows={4} />
      </View>
    );
  }

  if (failed && albums.length === 0) {
    return (
      <View style={styles.container}>
        {header}
        <EmptyState
          icon={ImageOff}
          title="专辑加载失败"
          subtitle="稍后重试"
          action={(
            <ScalePress style={styles.retryBtn} onPress={() => setReloadKey((k) => k + 1)}>
              <Text style={styles.retryText}>重试</Text>
            </ScalePress>
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={(
          <EmptyState icon={Disc3} title="暂无专辑" subtitle="这位歌手还没有可展示的专辑" />
        )}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={styles.footer} color={colors.textTertiary} />
          ) : albums.length > 0 && !more ? (
            <Text style={styles.footerText}>共 {total ?? albums.length} 张 · 已全部加载</Text>
          ) : failed ? (
            <ScalePress style={styles.footerRetry} onPress={() => void loadMore()}>
              <Text style={styles.footerRetryText}>加载失败，点此重试</Text>
            </ScalePress>
          ) : null
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  listContent: { paddingHorizontal: spacing[4], paddingBottom: spacing[8] },
  row: { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },
  card: { width: CARD_W },
  cover: {
    width: CARD_W,
    height: CARD_W,
    borderRadius: GRID_CARD.coverRadius,
    backgroundColor: colors.bgHover,
  },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  cardName: {
    ...textVariants.footnote,
    color: colors.textPrimary,
    marginTop: GRID_CARD.nameGap,
    minHeight: GRID_CARD.nameLineHeight * 2,
  },
  cardMeta: {
    ...textVariants.micro,
    color: colors.textTertiary,
    marginTop: GRID_CARD.metaGap,
    minHeight: GRID_CARD.metaLineHeight,
  },
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing[2],
    marginTop: spacing[5],
    marginBottom: spacing[3],
  },
  yearText: { ...textVariants.titleLg, color: colors.textPrimary, fontWeight: typography.weights.bold },
  yearCount: { ...textVariants.footnote, color: colors.textTertiary },
  footer: { marginVertical: spacing[5] },
  footerText: {
    ...textVariants.footnote,
    color: colors.textTertiary,
    textAlign: 'center',
    marginVertical: spacing[5],
  },
  footerRetry: { alignSelf: 'center', paddingVertical: spacing[3], paddingHorizontal: spacing[4] },
  footerRetryText: { ...textVariants.footnote, color: colors.accent },
  retryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
  },
  retryText: { ...textVariants.callout, color: colors.textInverse, fontWeight: typography.weights.semibold },
});
