/**
 * 网易云电台详情页（#742）：Hero + 节目分页。
 * 节目只复用 Song 播放身份；不提供收藏/换源，避免把节目混入歌曲语义。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Download, Radio } from 'lucide-react-native';
import {
  formatPlayCount,
  getDjRadioDetailRouted,
  getDjRadioProgramsRouted,
  type DjRadio,
  type DjRadioProgram,
} from '@mplayer/core';
import CollapsingHero from '../../components/CollapsingHero';
import SongRow from '../../components/SongRow';
import SongListSkeleton from '../../components/SongListSkeleton';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import EmptyState from '../../components/EmptyState';
import ScalePress from '../../components/ScalePress';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { downloadSong } from '../../services/downloadService';
import type { ThemeColors } from '../../theme/tokens';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

const PAGE_SIZE = 30;

const formatDate = (epochMs: number): string => {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleDateString('zh-CN');
};

export default function DjRadioDetailPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, name, pic, dj } = useLocalSearchParams<{
    id: string;
    name?: string;
    pic?: string;
    dj?: string;
  }>();
  const [radio, setRadio] = useState<DjRadio | null>(null);
  const [programs, setPrograms] = useState<DjRadioProgram[]>([]);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      const outcome = await getDjRadioDetailRouted('netease', id);
      if (cancelled) return;
      if (!outcome.ok) {
        setError(outcome.reason === 'not-found' ? '电台不存在' : '电台加载失败');
        setLoading(false);
        return;
      }
      setRadio(outcome.radio);
      const page = await getDjRadioProgramsRouted('netease', id, 0, PAGE_SIZE);
      if (cancelled) return;
      if (!page.ok) {
        setError('节目加载失败');
      } else {
        setPrograms(page.page.programs);
        setTotal(page.page.total);
        setMore(page.page.more);
      }
      setLoading(false);
    })().catch((e: unknown) => {
      if (!cancelled) {
        setError(e instanceof Error && e.message ? e.message : '电台加载失败');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  const loadMore = useCallback(async () => {
    if (!id || !more || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getDjRadioProgramsRouted('netease', id, programs.length, PAGE_SIZE);
      if (page.ok) {
        setPrograms((prev) => [...prev, ...page.page.programs]);
        setMore(page.page.more);
        setTotal(page.page.total);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [id, loadingMore, more, programs.length]);

  const playAll = useCallback(() => {
    if (programs.length === 0) return;
    usePlayerStore.getState().setQueue(programs, 0);
    playSong(programs[0]);
  }, [programs]);

  const fetchAllPrograms = useCallback(async () => {
    if (!id) return [];
    const all: DjRadioProgram[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const outcome = await getDjRadioProgramsRouted('netease', id, offset, 200);
      if (!outcome.ok) throw new Error(outcome.message);
      all.push(...outcome.page.programs);
      hasMore = outcome.page.more && outcome.page.programs.length > 0;
      offset += outcome.page.programs.length;
    }
    return all;
  }, [id]);

  const downloadAll = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const all = !more && programs.length >= total ? programs : await fetchAllPrograms();
      if (all.length === 0) throw new Error('这个电台还没有节目');
      const results = await Promise.allSettled(all.map((program) => downloadSong(program)));
      const completed = results.filter((result) => result.status === 'fulfilled').length;
      Alert.alert('下载完成', `已完成 ${completed}/${all.length} 期`);
    } catch (e) {
      Alert.alert('下载失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setDownloading(false);
    }
  }, [downloading, fetchAllPrograms, more, programs, total]);

  const renderItem = useCallback(({ item }: { item: DjRadioProgram }) => (
    <SongRow
      song={item}
      rank={item.serialNum || undefined}
      queueSongs={programs}
      hideActions
    />
  ), [programs]);

  if (!id) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']} style={styles.flex}>
          <Stack.Screen options={{ title: '电台', headerShown: true, headerStyle: { backgroundColor: colors.bgSurface }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
          <EmptyState icon={Radio} title="电台不存在" subtitle="链接里缺少电台 id" />
        </SafeAreaView>
        <BottomSafePlayerBar />
      </View>
    );
  }

  const title = radio?.name || name || '电台';
  const cover = radio?.picUrl || pic || '';
  const subtitle = radio?.dj.nickname || dj || '';
  const metaItems = radio
    ? [
        radio.category,
        total > 0 ? `${total} 期` : '',
        radio.subCount > 0 ? `${formatPlayCount(radio.subCount)} 订阅` : '',
        radio.lastProgramCreateTime ? `更新于 ${formatDate(radio.lastProgramCreateTime)}` : '',
      ].filter(Boolean)
    : [];
  const navRight = programs.length > 0 ? (
    <ScalePress
      style={styles.navAction}
      onPress={() => void downloadAll()}
      disabled={downloading}
      hitSlop={{ left: 8, right: 8, top: 8, bottom: 8 }}
    >
      <Download size={22} color={colors.textSecondary} />
    </ScalePress>
  ) : undefined;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={[]} style={styles.flex}>
        <Stack.Screen options={{ title, headerShown: false }} />
        <CollapsingHero
          cover={cover || undefined}
          fallbackIcon={<Radio size={72} color={colors.textInverse} />}
          navTitle={title}
          navRight={navRight}
          title={title}
          subtitle={subtitle || undefined}
          metaItems={metaItems}
          sectionHeader={!loading && programs.length > 0 ? `节目 · ${total || programs.length} 期` : undefined}
          actionLabel={programs.length > 0 ? '播放全部' : undefined}
          onAction={playAll}
          data={programs}
          keyExtractor={(item) => item.programId}
          renderItem={renderItem}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={more} hasData={programs.length > 0} />}
          ListEmptyComponent={
            loading ? (
              <SongListSkeleton rows={6} showSource={false} />
            ) : error ? (
              <EmptyState icon={Radio} title="电台加载失败" subtitle={error} />
            ) : (
              <EmptyState icon={Radio} title="这个电台还没有节目" subtitle="稍后再来看看" />
            )
          }
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  flex: { flex: 1 },
  navAction: { marginRight: spacing[2] },
});
