import { View, Text, StyleSheet, FlatList, Alert, Animated } from 'react-native';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Download, Trash2 } from 'lucide-react-native';
import type { Song } from '@mplayer/core';
import { useDownloadStore, type DownloadItem } from '../stores/downloadStore';
import { useDownloadProgressStore } from '../stores/downloadProgressStore';
import { getLocalUri, removeDownloadedFile } from '../services/downloadService';
import { playSong } from '../services/audioPlayer';
import { usePlayerStore } from '../stores/playerStore';
import { radius, spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import ScalePress, { pressScale } from '../components/ScalePress';
import LazyCover from '../components/LazyCover';
import { useAnimatedBg } from '../theme/AnimatedBg';
import EmptyState from '../components/EmptyState';
import BottomSafePlayerBar from '../components/BottomSafePlayerBar';

const STATUS_LABELS: Record<string, string> = {
  downloading: '下载中',
  done: '已下载',
  error: '失败',
};

/**
 * 本地歌曲（2026-11-17 起从底部 tab 移入 Stack）：入口在「歌单」页的本地歌曲行，
 * 保存位置移到设置页。原生 header 承担页名与返回，底部只保留迷你播放栏。
 */
export default function DownloadPage() {
  const { colors, isDark } = useTheme();
  const animatedBg = useAnimatedBg();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const items = useDownloadStore((s) => s.items);
  const removeItem = useDownloadStore((s) => s.removeItem);
  const purgeFailed = useDownloadStore((s) => s.purgeFailed);
  const currentSong = usePlayerStore((s) => s.currentSong);

  // 挂载时清除历史残留的失败条目（新失败已在下载服务里自动移除）
  useEffect(() => {
    purgeFailed();
  }, [purgeFailed]);

  const handlePlay = useCallback((item: DownloadItem) => {
    if (item.status !== 'done') return;
    const localSong: Song = {
      id: `local-${item.key}`,
      name: item.name,
      artist: item.artist,
      album: '',
      duration: 0,
      sourceType: 'local',
      url: getLocalUri(item.fileName),
      cover: '',
      lrc: '',
    };
    usePlayerStore.getState().setQueue([localSong], 0);
    playSong(localSong);
  }, []);

  const handleRemove = useCallback((item: DownloadItem) => {
    Alert.alert('删除下载', `确定删除《${item.name}》的本地文件吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await removeDownloadedFile(item.fileName, item.publicUri).catch(() => {});
          removeItem(item.key);
        },
      },
    ]);
  }, [removeItem]);

  return (
    <Animated.View style={[styles.container, { backgroundColor: animatedBg }]}>
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack.Screen options={{
          title: '本地歌曲',
          headerShown: true,
          headerStyle: { backgroundColor: colors.bgSurface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }} />
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          contentContainerStyle={[
            items.length === 0 ? styles.emptyContent : styles.listContent,
            { paddingBottom: spacing[4] },
          ]}
          ListEmptyComponent={
            <EmptyState
              icon={Download}
              title="暂无下载任务"
              subtitle="在歌曲更多菜单中点击「下载」，或先去搜索想听的歌"
              actionLabel="去搜索歌曲"
              onAction={() => router.push('/search')}
            />
          }
          renderItem={({ item }) => (
            <DownloadRow
              item={item}
              isCurrent={currentSong?.id === `local-${item.key}`}
              styles={styles}
              colors={colors}
              onPlay={handlePlay}
              onRemove={handleRemove}
            />
          )}
        />
      </SafeAreaView>
      <BottomSafePlayerBar />
    </Animated.View>
  );
}

interface DownloadRowProps {
  item: DownloadItem;
  isCurrent: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onPlay: (item: DownloadItem) => void;
  onRemove: (item: DownloadItem) => void;
}

/**
 * 下载行：进度只在行内订阅瞬时读模型（downloadProgressStore）。
 * 进度事件不再让整页/整列表重渲染；行组件 memo 后，未变化的行也不重渲染。
 */
const DownloadRow = memo(function DownloadRow({
  item, isCurrent, styles, colors, onPlay, onRemove,
}: DownloadRowProps) {
  const progress = useDownloadProgressStore((s) =>
    Math.max(0, Math.min(s.progressByKey[item.key] ?? 0, 100))
  );

  return (
    <ScalePress
      style={styles.row}
      pressScaleTo={pressScale.row}
      onPress={() => onPlay(item)}
      disabled={item.status !== 'done'}
    >
      <View style={styles.rowMain}>
        <View style={styles.coverWrap}>
          <LazyCover uri={item.cover} style={styles.cover} />
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, isCurrent && styles.nameActive]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>{item.artist}</Text>
        </View>
        <Text style={[styles.status, item.status === 'error' && styles.statusError]}>
          {item.status === 'downloading'
            ? progress > 0
              ? `下载中 ${progress}%`
              : '下载中…'
            : STATUS_LABELS[item.status]}
        </Text>
        {item.status === 'done' && (
          <ScalePress
            onPress={() => onRemove(item)}
            style={styles.deleteBtn}
            accessibilityLabel={`删除下载：《${item.name}》`}
          >
            <Trash2 size={18} color={colors.textSecondary} />
          </ScalePress>
        )}
      </View>
      {item.status === 'downloading' && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      )}
    </ScalePress>
  );
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 主题切换平滑过渡（M3）：根部应用共享 Animated 背景色
  container: { flex: 1 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  listContent: {},
  /* 列表行（对齐 SongRow 惯例） */
  row: {
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
  },
  coverWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.bgHover,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing[3],
  },
  cover: { width: 44, height: 44, borderRadius: radius.sm },
  info: { flex: 1, marginRight: spacing[3] },
  name: { ...textVariants.body, fontWeight: '600', color: colors.textPrimary },
  nameActive: { color: colors.accent },
  artist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  status: { ...textVariants.caption, color: colors.textSecondary, marginRight: spacing[3], fontVariant: ['tabular-nums'] },
  // 语义色当文字走 dangerText（ADR-0006）
  statusError: { color: colors.dangerText },
  // 删除热区 ≥44（与封面同高，不额外撑高行）
  deleteBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.bgHover,
    overflow: 'hidden',
    marginBottom: spacing[3],
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
});
