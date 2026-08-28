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
import { musicApi, getDirectClient } from '@mplayer/core';
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

/** QQ 榜单旧结构（QQ 内容迁移在后续票，#278 仅迁网易；rank 由索引推导）。 */
interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

/** 网易榜单：经能力面直调 getToplists，按 id（`${source}:${sourceId}`）取组。 */
async function neteaseToplistSongs(sourceId: number): Promise<Song[]> {
  const groups = await getDirectClient('netease')!.getToplists!();
  return groups.find((g) => g.id === `netease:${sourceId}`)?.songs ?? [];
}

/** QQ 榜单旧门面 → Song（QQ 内容迁移在后续票，#278 仅迁网易；rank 由索引推导）。 */
async function qqToplistSongs(kind: 'hot' | 'new'): Promise<Song[]> {
  const raw: HotlistSong[] = kind === 'hot' ? await musicApi.getQQHotlist() : await musicApi.getQQNewSongList();
  return raw.map((item) => toSong(item, 'qq'));
}

const API_MAP: Record<
  string,
  { fetcher: () => Promise<Song[]>; sourceType: SourceKey }
> = {
  neteaseHotlist: { fetcher: () => neteaseToplistSongs(3778678), sourceType: 'netease' },
  neteaseNew: { fetcher: () => neteaseToplistSongs(3779629), sourceType: 'netease' },
  qqHotlist: { fetcher: () => qqToplistSongs('hot'), sourceType: 'qq' },
  qqNew: { fetcher: () => qqToplistSongs('new'), sourceType: 'qq' },
};

function toSong(item: HotlistSong, sourceType: SourceKey): Song {
  return {
    id: item.id,
    name: item.name,
    artist: item.artists,
    album: item.album,
    cover: item.cover,
    url: '',
    lrc: '',
    duration: 0,
    sourceType,
  };
}

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
      // fetcher 统一返回 Song[]（网易经能力面带内联歌词；QQ 由旧结构转换）
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
