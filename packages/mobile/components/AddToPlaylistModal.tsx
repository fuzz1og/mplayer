import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, TextInput, Platform,
} from 'react-native';
import { CircleCheck, ListMusic, Plus } from 'lucide-react-native';
import type { Song, SourceKey } from '@mplayer/core';
import { usePlaylistStore } from '../stores/playlistStore';
import { SOURCE_LABELS } from '../stores/sourceStore';
import {radius, spacing, textVariants, opacity} from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import BottomSheet from './BottomSheet';
import ScalePress, { pressScale } from './ScalePress';

function sourceLabel(sourceType?: string): string {
  return SOURCE_LABELS[sourceType as SourceKey] || sourceType || '未知';
}

interface Props {
  visible: boolean;
  /** 单曲模式：与 songs 互斥 */
  song?: Song | null;
  /**
   * 批量模式：与 song 互斥。点击歌单只调一次 addSongs（整批一次 set = 一次持久化），
   * 不逐首弹同名 Alert——跨源同名在批量语义下直接并入（与桌面 BatchAddToPlaylistModal 同做法）。
   */
  songs?: Song[] | null;
  onClose: () => void;
}

export default function AddToPlaylistModal({ visible, song, songs, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playlists = usePlaylistStore(s => s.playlists);
  const addSong = usePlaylistStore(s => s.addSong);
  const addSongs = usePlaylistStore(s => s.addSongs);
  const removeSong = usePlaylistStore(s => s.removeSong);
  const createPlaylist = usePlaylistStore(s => s.createPlaylist);
  const [addedName, setAddedName] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [newName, setNewName] = useState('');

  const batchSongs = songs && songs.length > 0 ? songs : null;
  const isBatch = batchSongs !== null;
  const targetCount = isBatch ? batchSongs.length : 1;

  // 每次打开都是一次全新的加入流程：名字输入与成功态都要复位
  useEffect(() => {
    if (visible) {
      setNewName('');
      setAddedName(null);
      setAddedCount(0);
    }
  }, [visible]);

  const showSuccess = useCallback((playlistName: string, count: number) => {
    setAddedName(playlistName);
    setAddedCount(count);
    setTimeout(() => {
      setAddedName(null);
      onClose();
    }, 1200);
  }, [onClose]);

  const handleSelect = (playlistId: string, playlistName: string) => {
    // —— 批量模式：整批只写一轮 ——
    if (batchSongs) {
      addSongs(playlistId, batchSongs);
      showSuccess(playlistName, batchSongs.length);
      return;
    }
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
              showSuccess(playlistName, 1);
            },
          },
        ]
      );
      return;
    }
    addSong(playlistId, song);
    showSuccess(playlistName, 1);
  };

  /**
   * 就地新建歌单并**立即**把本次曲目写进去（一轮写入，不要求用户再点一次）。
   * createPlaylist 返回新 id；批量走 addSongs（整批一次 set），单曲走 addSong。
   */
  const handleCreateAndAdd = () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const id = createPlaylist(name);
      if (batchSongs) {
        addSongs(id, batchSongs);
        showSuccess(name, batchSongs.length);
      } else if (song) {
        addSong(id, song);
        showSuccess(name, 1);
      } else {
        // 两个入参都没给：新歌单已建，但没有可写的曲目——关掉即可
        onClose();
      }
    } catch (e) {
      Alert.alert('新建歌单失败', e instanceof Error && e.message ? e.message : '请重试');
    }
  };

  const emptyName = newName.trim().length === 0;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {addedName ? (
        <View style={styles.successBox}>
          <CircleCheck size={48} color={colors.accent} />
          <Text style={styles.successText}>
            {isBatch
              ? `已加入 ${addedCount} 首到「${addedName}」`
              : `已加入歌单「${addedName}」`}
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.title}>加入歌单</Text>
          {isBatch ? (
            <Text style={styles.songName} numberOfLines={1}>本次选择的 {targetCount} 首歌曲</Text>
          ) : song ? (
            <Text style={styles.songName} numberOfLines={1}>{song.name}</Text>
          ) : null}

          {/* 新建歌单行：空态下这是唯一可用的操作，所以放在列表之前 */}
          <View style={styles.createRow}>
            <TextInput
              style={styles.createInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="新建歌单..."
              placeholderTextColor={colors.inputPlaceholder}
              returnKeyType="done"
              onSubmitEditing={handleCreateAndAdd}
              autoCorrect={false}
            />
            <ScalePress
              style={[styles.createBtn, emptyName && styles.createBtnDisabled]}
              onPress={handleCreateAndAdd}
              disabled={emptyName}
            >
              <Plus size={16} color={colors.textInverse} />
              <Text style={styles.createBtnText}>
                {isBatch ? `新建并加入 ${targetCount} 首` : '新建并加入'}
              </Text>
            </ScalePress>
          </View>

          {playlists.length === 0 ? (
            <View style={styles.emptyBox}>
              <ListMusic size={40} color={colors.textTertiary} />
              <Text style={styles.emptyText}>还没有歌单</Text>
              <Text style={styles.emptyHint}>在上方输入名字即可新建</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {playlists.map(p => (
                <ScalePress
                  key={p.id}
                  style={styles.item}
                  pressScaleTo={pressScale.row}
                  onPress={() => handleSelect(p.id, p.name)}
                >
                  <ListMusic size={22} color={colors.accent} />
                  <Text style={styles.itemText}>{p.name}</Text>
                  <Text style={styles.itemCount}>{p.songs.length}首</Text>
                </ScalePress>
              ))}
            </View>
          )}
          <ScalePress style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>取消</Text>
          </ScalePress>
        </>
      )}
    </BottomSheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  createInput: {
    flex: 1,
    // Android TextInput 在定高容器里自带内边距，同 TopBar 的处理：显式给高度与垂直居中
    height: Platform.OS === 'android' ? 44 : 40,
    paddingHorizontal: spacing[3],
    paddingVertical: 0,
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
    color: colors.textPrimary,
    ...textVariants.callout,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    height: Platform.OS === 'android' ? 44 : 40,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  createBtnDisabled: {
    opacity: opacity.disabled,
  },
  createBtnText: {
    ...textVariants.footnote,
    fontWeight: '600',
    color: colors.textInverse,
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
    color: colors.textSecondary,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: spacing[8],
  },
  emptyText: {
    ...textVariants.callout,
    color: colors.textSecondary,
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
