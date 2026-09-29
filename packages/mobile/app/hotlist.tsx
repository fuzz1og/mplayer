import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  RefreshControl,
  Text,
} from 'react-native';
import type { ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  formatPlayCount,
  getToplistDetailRouted,
  getToplistSongs,
  SOURCE_DISPLAY_NAMES,
  TOPLIST_SOURCE_IDS,
} from '@mplayer/core';
import type { Song, SourceKey, ToplistDetail } from '@mplayer/core';
import CollapsingHero from '../components/CollapsingHero';
import CoverFallback from '../components/CoverFallback';
import HeroSkeleton from '../components/HeroSkeleton';
import SongRow from '../components/SongRow';

/** 榜单行：只承载歌 + 榜位（不动 SongList 的判别联合，Hero 的 data 只要这个形状） */
type HotlistRow = { kind: 'song'; key: string; song: Song; rank: number };
import BottomSafePlayerBar from '../components/BottomSafePlayerBar';
import { playSong } from '../services/audioPlayer';
import { searchStrictMatch } from '../services/songResources';
import { usePlayerStore } from '../stores/playerStore';
import { spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

// 榜单 id 契约取自 core TOPLIST_SOURCE_IDS（#286）：取组走 getToplistSongs（无客户端统一抛错），键面仅含已实现榜单能力的三源
// sourceId 同时喂榜单元数据腿（#465）——它是榜单在源内的身份，Hero 靠它换封面/播放量。
const API_MAP: Record<
  string,
  { fetcher: () => Promise<Song[]>; sourceType: SourceKey; sourceId: number | string }
> = {
  neteaseHotlist: { fetcher: () => getToplistSongs('netease', TOPLIST_SOURCE_IDS.netease.hot), sourceType: 'netease', sourceId: TOPLIST_SOURCE_IDS.netease.hot },
  neteaseNew: { fetcher: () => getToplistSongs('netease', TOPLIST_SOURCE_IDS.netease.new), sourceType: 'netease', sourceId: TOPLIST_SOURCE_IDS.netease.new },
  qqHotlist: { fetcher: () => getToplistSongs('qq', TOPLIST_SOURCE_IDS.qq.hot), sourceType: 'qq', sourceId: TOPLIST_SOURCE_IDS.qq.hot },
  qqNew: { fetcher: () => getToplistSongs('qq', TOPLIST_SOURCE_IDS.qq.new), sourceType: 'qq', sourceId: TOPLIST_SOURCE_IDS.qq.new },
};

export default function HotlistPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { key, title } = useLocalSearchParams<{ key: string; title: string }>();
  const [songs, setSongs] = useState<Song[]>([]);
  const [detail, setDetail] = useState<ToplistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const config = key ? API_MAP[key] : undefined;

  const fetchSongs = useCallback(async () => {
    if (!config) return;
    try {
      // fetcher 统一返回 Song[]（各源榜单均经能力面 getToplists，#279）
      const list = await config.fetcher();
      setSongs(list);
    } catch (err) {
      console.error('加载榜单失败:', err);
    }
  }, [config]);

  /**
   * 榜单元数据（#465）：Hero 的封面/播放量。
   * 与歌曲**并行**取，且**失败不影响播放**——outcome 是判别联合，
   * `unsupported`（如 Q 音：榜单索引接口匿名恒拒）与 `failed` 都只是「这次没有元数据」，
   * Hero 退回路由带的 title + 生成兜底封面（不是错误态，也不拖死整页）。
   */
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    // 先清元数据：同一路由换榜单参数时 expo-router 会复用组件实例，
    // 不清就会把上一个榜单的封面/播放量串到这一个（Q 音拿不到元数据时尤其明显——
    // 它的 fetch 永远不成功，于是永远显示上一个榜单的封面）。
    setDetail(null);
    void getToplistDetailRouted(config.sourceType, config.sourceId)
      .then((out) => {
        if (!cancelled && out.ok) setDetail(out.detail);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [config]);

  useEffect(() => {
    if (!config) return;
    // 同理清歌曲与 loading：换榜单必须先回到骨架，而不是旧榜的歌 + 新榜的元数据混着闪
    setSongs([]);
    setLoading(true);
    fetchSongs().finally(() => setLoading(false));
  }, [config, fetchSongs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSongs();
    setRefreshing(false);
  }, [fetchSongs]);

  // 稳定回调（#411）：对外只收 song，heat 榜需要的下标在这里现算
  const handlePress = useCallback(
    async (song: Song) => {
      const index = songs.findIndex((s) => s.id === song.id);
      // 热榜数据不含 url/lrc：路由搜索（直连 + tier3 兜底）+ 严格匹配，
      // 命中后只回填 url/lrc 再播原歌——不播搜索结果本体（防同名 cover 错播）
      let s: Song = song;
      if (!song.url) {
        try {
          const hit = await searchStrictMatch(song);
          if (hit) s = { ...song, url: hit.url || '', lrc: hit.lrc || '' };
        } catch {}
      }
      usePlayerStore.getState().setQueue(songs, Math.max(0, index));
      playSong(s);
    },
    [songs],
  );

  const handlePlayAll = useCallback(() => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    void playSong(songs[0]!);
  }, [songs]);

  const rows = useMemo<HotlistRow[]>(
    () => songs.map((song, i) => ({ kind: 'song' as const, key: song.id, song, rank: i + 1 })),
    [songs],
  );

  // renderItem 用 useCallback 收口（#411 同一条纪律）：内联箭头会逐帧击穿 SongRow 的 memo
  const renderItem = useCallback<ListRenderItem<HotlistRow>>(
    ({ item }) => <SongRow song={item.song} rank={item.rank} onPress={handlePress} />,
    [handlePress],
  );

  if (!config) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <Stack.Screen
            options={{
              title: title || '未知榜单',
              headerShown: true,
              headerStyle: { backgroundColor: colors.bgSurface },
              headerTintColor: colors.textPrimary,
              headerShadowVisible: false,
            }}
          />
          <Text style={styles.errorText}>未知榜单类型</Text>
        </SafeAreaView>
        <BottomSafePlayerBar />
      </View>
    );
  }

  const displayName = detail?.name ?? title ?? '榜单';
  const metaItems = [
    detail?.playCount != null ? `播放: ${formatPlayCount(detail.playCount)}` : null,
    songs.length > 0 ? `共 ${songs.length} 首` : null,
  ].filter((v): v is string => v !== null);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: displayName, headerShown: false }} />
      {loading ? (
        <HeroSkeleton rows={8} showRank />
      ) : (
        <CollapsingHero<HotlistRow>
          // 封面为空（该源拿不到）时铺满生成兜底封面——不是错误态（#465）
          cover={detail?.coverImgUrl || undefined}
          coverFallback={<CoverFallback name={displayName} label={SOURCE_DISPLAY_NAMES[config.sourceType]} />}
          navTitle={displayName}
          title={displayName}
          subtitle={SOURCE_DISPLAY_NAMES[config.sourceType]}
          metaItems={metaItems}
          actionLabel="播放全部"
          onAction={handlePlayAll}
          data={rows}
          keyExtractor={(item, i) => `${item.key}-${i}`}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
        />
      )}
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  errorText: { color: colors.textSecondary, ...textVariants.callout, textAlign: 'center', marginTop: spacing[10] },
});
