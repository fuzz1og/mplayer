import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useMemo } from 'react';
import { Download, Music, Trash2 } from 'lucide-react-native';
import { Paths } from 'expo-file-system';
import type { Song } from '@mplayer/core';
import { useDownloadStore } from '../../stores/downloadStore';
import { getLocalUri, removeDownloadedFile, pickDownloadDirectory } from '../../services/downloadService';
import { playSong } from '../../services/audioPlayer';
import { usePlayerStore } from '../../stores/playerStore';
import {radius, textVariants} from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useSettingsStore } from '../../stores/settingsStore';

const STATUS_LABELS: Record<string, string> = {
  downloading: '下载中',
  done: '已下载',
  error: '失败',
};

export default function DownloadPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const items = useDownloadStore((s) => s.items);
  const removeItem = useDownloadStore((s) => s.removeItem);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const downloadDirUri = useSettingsStore((s) => s.downloadDirUri);
  const authorized = Boolean(downloadDirUri);

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
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={
          <TouchableOpacity style={styles.pathBox} onPress={handlePickDir} activeOpacity={0.7}>
            <Text style={styles.pathLabel}>保存位置</Text>
            <Text style={styles.pathText} numberOfLines={2}>
              {authorized ? '系统下载目录（已授权）' : `${Paths.document.uri}mplayer-downloads/`}
            </Text>
            <Text style={styles.pathHint}>
              {authorized ? '点击可更换目录' : '点击选择系统下载目录；未授权时保存在应用私有目录'}
            </Text>
          </TouchableOpacity>
        }
        contentContainerStyle={items.length === 0 ? styles.emptyContent : undefined}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Download size={64} color={colors.textDisabled} />
            <Text style={styles.title}>暂无下载任务</Text>
            <Text style={styles.subtitle}>在歌曲更多菜单中点击「下载」</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isCurrent = currentSong?.id === `local-${item.key}`;
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => handlePlay(item)}
              disabled={item.status !== 'done'}
            >
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
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  emptyContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  emptyBox: { alignItems: 'center' },
  title: { ...textVariants.callout, color: colors.textSecondary, marginTop: 16 },
  subtitle: { ...textVariants.footnote, color: colors.textTertiary, marginTop: 8 },
  pathBox: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  pathLabel: { ...textVariants.caption, color: colors.textSecondary, marginBottom: 4 },
  pathText: { ...textVariants.caption, color: colors.textTertiary, fontFamily: 'monospace' },
  pathHint: { ...textVariants.micro, fontWeight: '400', color: colors.textTertiary, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  coverWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.bgHover,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: { flex: 1, marginRight: 12 },
  name: { ...textVariants.body, fontWeight: '600', color: colors.textPrimary },
  nameActive: { color: colors.accent },
  artist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  status: { ...textVariants.caption, color: colors.textSecondary, marginRight: 12 },
  statusError: { color: colors.danger },
});
