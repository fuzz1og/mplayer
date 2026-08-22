import { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Alert,
} from 'react-native';
import { CircleCheck, ListMusic } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Song, SourceKey } from '@mplayer/core';
import { usePlaylistStore } from '../stores/playlistStore';
import { SOURCE_LABELS } from '../stores/sourceStore';
import {radius, spacing, textVariants} from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

function sourceLabel(sourceType?: string): string {
  return SOURCE_LABELS[sourceType as SourceKey] || sourceType || '未知';
}

interface Props {
  visible: boolean;
  song: Song | null;
  onClose: () => void;
}

export default function AddToPlaylistModal({ visible, song, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const playlists = usePlaylistStore(s => s.playlists);
  const addSong = usePlaylistStore(s => s.addSong);
  const removeSong = usePlaylistStore(s => s.removeSong);
  const [addedName, setAddedName] = useState<string | null>(null);

  const handleSelect = (playlistId: string, playlistName: string) => {
    if (!song) return;
    const playlist = playlists.find((p) => p.id === playlistId);
    // 同一首歌（同 id）已在歌单中 → 直接提示不加
    if (playlist?.songs.some((s) => s.id === song.id)) {
      Alert.alert('提示', '这首歌已在歌单中');
      return;
    }
    // 跨源同名同歌手 → 弹窗让用户选保留哪首
    const dup = playlist?.songs.find(
      (s) => s.name === song.name && s.artist === song.artist && s.sourceType !== song.sourceType
    );
    if (dup) {
      Alert.alert(
        '发现同名歌曲',
        `歌单中已有「${song.name}」的${sourceLabel(dup.sourceType)}版本，要替换成这首${sourceLabel(song.sourceType)}版本吗？`,
        [
          { text: '取消', style: 'cancel' },
          // 保留原版 = 什么都没做，直接关闭（不能显示"已加入"成功提示）
          { text: '保留原版', onPress: onClose },
          {
            text: '替换为新版',
            onPress: () => {
              removeSong(playlistId, dup.id);
              addSong(playlistId, song);
              setAddedName(playlistName);
              showSuccess();
            },
          },
        ]
      );
      return;
    }
    addSong(playlistId, song);
    setAddedName(playlistName);
    showSuccess();
  };

  const showSuccess = () => {
    setTimeout(() => {
      setAddedName(null);
      onClose();
    }, 1200);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        {addedName ? (
          <View style={styles.successBox}>
            <CircleCheck size={48} color={colors.accent} />
            <Text style={styles.successText}>已加入歌单「{addedName}」</Text>
          </View>
        ) : (
          <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + spacing[6] }]} activeOpacity={1} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>加入歌单</Text>
            {song && (
              <Text style={styles.songName} numberOfLines={1}>{song.name}</Text>
            )}
            {playlists.length === 0 ? (
              <View style={styles.emptyBox}>
                <ListMusic size={40} color={colors.textTertiary} />
                <Text style={styles.emptyText}>暂无歌单</Text>
                <Text style={styles.emptyHint}>请先在歌单页面创建</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {playlists.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.item}
                    onPress={() => handleSelect(p.id, p.name)}
                  >
                    <ListMusic size={22} color={colors.accent} />
                    <Text style={styles.itemText}>{p.name}</Text>
                    <Text style={styles.itemCount}>{p.songs.length}首</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing[6],
    paddingTop: spacing[3],
    paddingBottom: 36,
    width: '100%',
    maxHeight: '70%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgActive,
    alignSelf: 'center',
    marginBottom: spacing[4],
  },
  title: {
    ...textVariants.title,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing[1],
  },
  songName: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing[5],
  },
  list: {
    marginBottom: spacing[3],
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  itemText: {
    ...textVariants.callout,
    color: colors.textPrimary,
    marginLeft: spacing[3],
    flex: 1,
  },
  itemCount: {
    ...textVariants.footnote,
    color: colors.textTertiary,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: spacing[8],
  },
  emptyText: {
    ...textVariants.callout,
    color: colors.textTertiary,
    marginTop: spacing[3],
  },
  emptyHint: {
    ...textVariants.footnote,
    color: colors.textTertiary,
    marginTop: spacing[1],
  },
  cancelBtn: {
    marginTop: spacing[2],
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
  },
  cancelText: {
    ...textVariants.sectionHeader,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  successBox: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    padding: spacing[8],
    alignItems: 'center',
    marginBottom: 100,
  },
  successText: {
    ...textVariants.sectionHeader,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing[3],
  },
});
