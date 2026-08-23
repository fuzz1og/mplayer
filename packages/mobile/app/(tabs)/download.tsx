import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Animated } from 'react-native';
import { useEffect, useMemo } from 'react';
import { Download, Music, Trash2, ChevronRight } from 'lucide-react-native';
import { Paths } from 'expo-file-system';
import type { Song } from '@mplayer/core';
import { useDownloadStore } from '../../stores/downloadStore';
import { getLocalUri, removeDownloadedFile, pickDownloadDirectory } from '../../services/downloadService';
import { playSong } from '../../services/audioPlayer';
import { usePlayerStore } from '../../stores/playerStore';
import {radius, shadow, spacing, textVariants} from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight } from '../../components/chromeMetrics';

import { useSettingsStore } from '../../stores/settingsStore';
import EmptyState from '../../components/EmptyState';

const STATUS_LABELS: Record<string, string> = {
  downloading: '下载中',
  done: '已下载',
  error: '失败',
};

export default function DownloadPage() {
  const { colors } = useTheme();
  const animatedBg = useAnimatedBg();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const items = useDownloadStore((s) => s.items);
  const removeItem = useDownloadStore((s) => s.removeItem);
  const purgeFailed = useDownloadStore((s) => s.purgeFailed);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const downloadDirUri = useSettingsStore((s) => s.downloadDirUri);
  const authorized = Boolean(downloadDirUri);

  // 挂载时清除历史残留的失败条目（新失败已在下载服务里自动移除）
  useEffect(() => {
    purgeFailed();
  }, [purgeFailed]);

  const handlePlay = (item: (typeof items)[number]) => {
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
  };

  const handleRemove = (item: (typeof items)[number]) => {
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
  };

  const handlePickDir = async () => {
    try {
      await pickDownloadDirectory();
    } catch (e) {
      Alert.alert('选择目录失败', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Animated.View style={[styles.container, { backgroundColor: animatedBg }]}>
      {/* 保存位置随内容滚动、从悬浮 TopBar 下穿过（M2）；静态放列表外会被 TopBar 盖住。
          空列表时也不被居中：ListHeader 恒在 EmptyState 之上 */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[
          items.length === 0 ? styles.emptyContent : styles.listContent,
          { paddingTop: topChromeHeight(insets.top), paddingBottom: bottomChromeHeight(insets.bottom, true) + 24 },
        ]}
        ListHeaderComponent={
          <TouchableOpacity style={styles.pathBox} onPress={handlePickDir} activeOpacity={0.7}>
            <View style={styles.pathInfo}>
              <Text style={styles.pathLabel}>保存位置</Text>
              <Text style={styles.pathText} numberOfLines={2}>
                {authorized ? '系统下载目录（已授权）' : `${Paths.document.uri}mplayer-downloads/`}
              </Text>
              <Text style={styles.pathHint}>
                {authorized ? '点击可更换目录' : '点击选择系统下载目录；未授权时保存在应用私有目录'}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        }
        ListEmptyComponent={
          <EmptyState
            icon={Download}
            title="暂无下载任务"
            subtitle="在歌曲更多菜单中点击「下载」"
          />
        }
        renderItem={({ item }) => {
          const isCurrent = currentSong?.id === `local-${item.key}`;
          const progress = Math.max(0, Math.min(item.progress ?? 0, 100));
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => handlePlay(item)}
              disabled={item.status !== 'done'}
            >
              <View style={styles.rowMain}>
                <View style={styles.coverWrap}>
                  <Music size={22} color={colors.textSecondary} />
                </View>
                <View style={styles.info}>
                  <Text style={[styles.name, isCurrent && styles.nameActive]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.artist} numberOfLines={1}>{item.artist}</Text>
                </View>
                <Text style={[styles.status, item.status === 'error' && styles.statusError]}>
                  {item.status === 'downloading'
                    ? item.progress != null && item.progress > 0
                      ? `下载中 ${item.progress}%`
                      : '下载中…'
                    : STATUS_LABELS[item.status]}
                </Text>
                {item.status === 'done' && (
                  <TouchableOpacity onPress={() => handleRemove(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Trash2 size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
              </View>
              {item.status === 'downloading' && (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </Animated.View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 主题切换平滑过渡（M3）：根部应用共享 Animated 背景色
  container: { flex: 1 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  listContent: { paddingBottom: 24 },
  /* 保存位置卡片 */
  pathBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    ...shadow.sm,
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  pathInfo: { flex: 1, marginRight: spacing[2] },
  pathLabel: { ...textVariants.caption, color: colors.textSecondary, marginBottom: 4 },
  pathText: { ...textVariants.caption, color: colors.textTertiary, fontFamily: 'monospace' },
  pathHint: { ...textVariants.micro, fontWeight: '400', color: colors.textTertiary, marginTop: 4 },
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
    paddingVertical: 10,
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
  info: { flex: 1, marginRight: spacing[3] },
  name: { ...textVariants.body, fontWeight: '600', color: colors.textPrimary },
  nameActive: { color: colors.accent },
  artist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  status: { ...textVariants.caption, color: colors.textSecondary, marginRight: spacing[3], fontVariant: ['tabular-nums'] },
  statusError: { color: colors.danger },
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
