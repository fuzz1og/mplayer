/**
 * 专辑详情页（#406 一/二期 + #407 P0 消费端）。
 *
 * 四态齐备且互不混淆：
 * - **缺 id**（畸形深链）：独立一屏「专辑不存在」+ 原生 header 返回（不再伪装成空专辑）
 * - **加载**：Hero 常驻（封面/标题来自路由参数）+ 同屏行骨架 —— 慢网首帧也有返回按钮
 * - **失败**：「专辑加载失败 / 该来源暂不支持专辑详情」+ 重试（不再与「真的没歌」混淆，也不显示「0 首」）
 * - **成功/空**：Hero 信息区章节化 + 列表；空专辑走 EmptyState
 *
 * 契约侧：走 core `getAlbumDetailRouted(source, id)`（不再 `getDirectClient('netease')!` 双重断言），
 * source 从路由参数来、缺省 netease（#407：跨源 id 不通，一律 source + id 二元组）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Disc3 } from 'lucide-react-native';
import { getAlbumDetailRouted, type Album, type Song, type SourceKey } from '@mplayer/core';
import AlbumHero from '../../components/AlbumHero';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import EmptyState from '../../components/EmptyState';
import { replaceSongInList } from '../../services/songListOps';
import type { AlbumListState } from '../../components/AlbumHero';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

/** 路由允许的源（#407）：跨源 id 不通，跳转方必须把 source 带过来，缺省 netease。 */
const ROUTE_SOURCES: SourceKey[] = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qianqian', 'soda'];

export default function AlbumDetailPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, name, pic, artist, source } = useLocalSearchParams<{
    id: string; name?: string; pic?: string; artist?: string; source?: string;
  }>();
  const routeSource: SourceKey = ROUTE_SOURCES.includes(source as SourceKey) ? (source as SourceKey) : 'netease';

  const [album, setAlbum] = useState<Album | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [state, setState] = useState<AlbumListState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState('loading');
    setErrorMessage('');
    (async () => {
      const outcome = await getAlbumDetailRouted(routeSource, id);
      if (cancelled) return;
      if (!outcome.ok) {
        // core 已把「该源不支持」与「抓取失败」分开，这里各自给文案（#407）
        setErrorMessage(outcome.reason === 'unsupported' ? '该来源暂不支持专辑详情' : '专辑加载失败');
        setState('error');
        return;
      }
      setAlbum(outcome.album);
      setSongs(outcome.songs);
      setState(outcome.songs.length > 0 ? 'ready' : 'empty');
    })().catch((e: unknown) => {
      if (cancelled) return;
      setErrorMessage(e instanceof Error && e.message ? e.message : '专辑加载失败');
      setState('error');
    });
    return () => { cancelled = true; };
  }, [id, routeSource, reloadKey]);

  // 单曲换源后更新列表（SongRow 更多菜单触发）。useCallback 零依赖（#411）：
  // setSongs 的函数式更新不依赖 songs，引用永久稳定，SongRow 的 memo 才生效。
  const handleSwap = useCallback((original: Song, swapped: Song) => {
    setSongs((prev) => replaceSongInList(prev, original.id, swapped));
  }, []);

  // 缺 id（畸形深链）：独立一屏 + 原生 header（全局 headerShown:false，Hero 不渲染时靠它给返回）
  if (!id) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']} style={styles.flex}>
          <Stack.Screen
            options={{
              title: name || '专辑',
              headerShown: true,
              headerStyle: { backgroundColor: colors.bgSurface },
              headerTintColor: colors.textPrimary,
              headerShadowVisible: false,
            }}
          />
          <EmptyState icon={Disc3} title="专辑不存在" subtitle="链接里缺少专辑 id" />
        </SafeAreaView>
        <BottomSafePlayerBar />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={[]} style={styles.flex}>
        <Stack.Screen options={{ title: album?.name || name || '专辑', headerShown: false }} />
        <AlbumHero
          album={album}
          songs={songs}
          state={state}
          errorMessage={errorMessage}
          onRetry={retry}
          onSwap={handleSwap}
          fallbackName={name || '专辑'}
          fallbackPic={pic || ''}
          fallbackArtist={artist || ''}
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  flex: { flex: 1 },
});
