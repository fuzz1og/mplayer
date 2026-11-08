import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Download, Radio } from 'lucide-react-native';
import {
  describeDjRadioFailure,
  fetchAllDjRadioPrograms,
  formatPlayCount,
  getDjRadioDetailRouted,
  getDjRadioProgramsRouted,
  type DjRadio,
  type DjRadioDetailOutcome,
  type DjRadioProgram,
  type DjRadioProgramsOutcome,
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
import { spacing, textVariants } from '../../theme/tokens';
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
  const [playingAll, setPlayingAll] = useState(false);
  const [error, setError] = useState('');
  const [detailFailure, setDetailFailure] = useState<DjRadioDetailOutcome | null>(null);
  const [programsFailure, setProgramsFailure] = useState<DjRadioProgramsOutcome | null>(null);
  const [programsError, setProgramsError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const allBusyRef = useRef(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setProgramsError('');
    setDetailFailure(null);
    setProgramsFailure(null);
    (async () => {
      const outcome = await getDjRadioDetailRouted('netease', id);
      if (cancelled) return;
      if (!outcome.ok) {
        setDetailFailure(outcome);
        setError(describeDjRadioFailure(outcome.reason, outcome.message));
        setLoading(false);
        return;
      }
      setRadio(outcome.radio);
      const page = await getDjRadioProgramsRouted('netease', id, 0, PAGE_SIZE);
      if (cancelled) return;
      if (!page.ok) {
        setProgramsFailure(page);
        setProgramsError(describeDjRadioFailure(page.reason, page.message));
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
  }, [id, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!id || !more || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getDjRadioProgramsRouted('netease', id, programs.length, PAGE_SIZE);
      if (page.ok) {
        setPrograms((prev) => [...prev, ...page.page.programs]);
        setMore(page.page.more);
        setTotal(page.page.total);
        setProgramsError('');
        setProgramsFailure(null);
      } else {
        setProgramsFailure(page);
        setProgramsError(describeDjRadioFailure(page.reason, page.message));
      }
    } finally {
      setLoadingMore(false);
    }
  }, [id, loadingMore, more, programs.length]);

  const guardAll = useCallback(() => {
    if (allBusyRef.current) return false;
    allBusyRef.current = true;
    return true;
  }, []);

  const releaseAll = useCallback(() => {
    allBusyRef.current = false;
  }, []);

  const fetchAllPrograms = useCallback(async () => {
    return fetchAllDjRadioPrograms(id, async (radioId, offset, limit) => {
      const outcome = await getDjRadioProgramsRouted('netease', radioId, offset, limit);
      if (!outcome.ok) throw new Error(outcome.message);
      return outcome.page;
    });
  }, [id]);

  const playAll = useCallback(async () => {
    if (!guardAll()) return;
    setPlayingAll(true);
    try {
      const all = await fetchAllPrograms();
      if (all.length === 0) throw new Error('这个电台还没有节目');
      usePlayerStore.getState().setQueue(all, 0);
      playSong(all[0]);
    } catch (e) {
      Alert.alert('播放失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setPlayingAll(false);
      releaseAll();
    }
  }, [fetchAllPrograms, guardAll, releaseAll]);

  const downloadAll = useCallback(async () => {
    if (!guardAll()) return;
    setDownloading(true);
    try {
      const all = await fetchAllPrograms();
      if (all.length === 0) throw new Error('这个电台还没有节目');
      const results = await Promise.allSettled(all.map((program) => downloadSong(program)));
      const completed = results.filter((result) => result.status === 'fulfilled').length;
      Alert.alert('下载完成', `已完成 ${completed}/${all.length} 期`);
    } catch (e) {
      Alert.alert('下载失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setDownloading(false);
      releaseAll();
    }
  }, [fetchAllPrograms, guardAll, releaseAll]);

  const renderItem = useCallback(({ item }: { item: DjRadioProgram }) => (
    <SongRow
      song={item}
      rank={item.serialNum || undefined}
      queueSongs={programs}
      description={item.description || undefined}
      hideSwap
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
      disabled={downloading || playingAll}
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
          actionLabel={programs.length > 0 ? (playingAll ? '准备中...' : '播放全部') : undefined}
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
            ) : error || programsError ? (
              <View>
                <EmptyState
                  icon={Radio}
                  title={error ? describeDjRadioFailure(detailFailure?.ok === false ? detailFailure.reason : undefined, error) : describeDjRadioFailure(programsFailure?.ok === false ? programsFailure.reason : undefined, programsError)}
                  subtitle={error || programsError}
                />
                {(detailFailure?.ok === false && detailFailure.reason !== 'not-found')
                  || (programsFailure?.ok === false && programsFailure.reason !== 'unsupported') ? (
                  <ScalePress style={styles.retry} onPress={() => setReloadKey((key) => key + 1)}>
                    <Text style={styles.retryText}>重试</Text>
                  </ScalePress>
                ) : null}
              </View>
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
  retry: { alignSelf: 'center', marginTop: spacing[4], paddingHorizontal: spacing[5], paddingVertical: spacing[2], borderRadius: 999, backgroundColor: colors.bgHover },
  retryText: { ...textVariants.footnote, color: colors.accent },
});
