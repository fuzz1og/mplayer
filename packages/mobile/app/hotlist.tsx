import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getToplistSongs, TOPLIST_SOURCE_IDS } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';
import SongListSkeleton from '../components/SongListSkeleton';
import SongRow from '../components/SongRow';
import BottomSafePlayerBar from '../components/BottomSafePlayerBar';
import { playSong } from '../services/audioPlayer';
import { probeSongsPrefetch } from '../services/songProbe';
import { searchStrictMatch } from '../services/songResources';
import { usePlayerStore } from '../stores/playerStore';
import {spacing, textVariants} from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

// 榜单 id 契约取自 core TOPLIST_SOURCE_IDS（#286）：取组走 getToplistSongs（无客户端统一抛错），键面仅含已实现榜单能力的三源
const API_MAP: Record<
  string,
  { fetcher: () => Promise<Song[]>; sourceType: SourceKey }
> = {
  neteaseHotlist: { fetcher: () => getToplistSongs('netease', TOPLIST_SOURCE_IDS.netease.hot), sourceType: 'netease' },
  neteaseNew: { fetcher: () => getToplistSongs('netease', TOPLIST_SOURCE_IDS.netease.new), sourceType: 'netease' },
  qqHotlist: { fetcher: () => getToplistSongs('qq', TOPLIST_SOURCE_IDS.qq.hot), sourceType: 'qq' },
  qqNew: { fetcher: () => getToplistSongs('qq', TOPLIST_SOURCE_IDS.qq.new), sourceType: 'qq' },
};

export default function HotlistPage() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { key, title } = useLocalSearchParams<{ key: string; title: string }>();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const config = key ? API_MAP[key] : undefined;

  const fetchSongs = useCallback(async () => {
    if (!config) return;
    try {
      // fetcher 统一返回 Song[]（各源榜单均经能力面 getToplists，#279）
      const list = await config.fetcher();
      setSongs(list);
      // 直连探测预取（与搜索/歌单/专辑页对齐）：直链写入预取缓存，
      // 点播 0 等待秒播。榜单 id 已统一为 songmid（#172），QQ 榜探测有效。
      void probeSongsPrefetch(list);
    } catch (err) {
      console.error('加载榜单失败:', err);
    }
  }, [config]);

  useEffect(() => {
    fetchSongs().finally(() => setLoading(false));
  }, [fetchSongs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSongs();
    setRefreshing(false);
  }, [fetchSongs]);

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

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack.Screen
          options={{
            title: title || '',
            headerShown: true,
            headerStyle: { backgroundColor: colors.bgSurface },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
          }}
        />
        {loading ? (
          <SongListSkeleton />
        ) : (
          <FlatList
            data={songs}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <SongRow
                song={item}
                rank={index + 1}
                onPress={async (song) => {
                  // 热榜数据不含 url/lrc：路由搜索（直连 + tier3 兜底）+ 严格匹配，
                  // 命中后只回填 url/lrc 再播原歌——不播搜索结果本体（防同名 cover 错播）
                  let s: Song = song;
                  if (!song.url) {
                    try {
                      const hit = await searchStrictMatch(song);
                      if (hit) s = { ...song, url: hit.url || '', lrc: hit.lrc || '' };
                    } catch {}
                  }
                  usePlayerStore.getState().setQueue(songs, index);
                  playSong(s);
                }}
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
              />
            }
          />
        )}
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  errorText: { color: colors.textSecondary, ...textVariants.callout, textAlign: 'center', marginTop: spacing[10] },
});
