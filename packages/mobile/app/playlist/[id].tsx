import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScalePress from '../../components/ScalePress';
import { CircleAlert, MoreVertical, Music2, Pencil, Trash2, Upload } from 'lucide-react-native';
import { useLocalSearchParams, Stack, router, useFocusEffect } from 'expo-router';
import { usePlaylistStore } from '../../stores/playlistStore';
import { useFavoriteStore } from '../../stores/favoriteStore';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import PlaylistHero from '../../components/PlaylistHero';
import PlaylistBatchBar from '../../components/PlaylistBatchBar';
import AddToPlaylistModal from '../../components/AddToPlaylistModal';
import BottomSheet from '../../components/BottomSheet';
import PlaylistImportSheet from '../../components/PlaylistImportSheet';
import {
  NO_SELECTION,
  areAllSelected,
  deselectAll,
  enterSelection,
  pickSelected,
  selectAll,
  toggleSelection,
  type PlaylistSelection,
} from '../../components/playlistSelection';
import { downloadSong } from '../../services/downloadService';
import type { Song } from '@mplayer/core';
import {opacity, radius, spacing, textVariants} from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export default function PlaylistDetailPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlists = usePlaylistStore((s) => s.playlists);
  const removeSong = usePlaylistStore((s) => s.removeSong);
  const removeSongs = usePlaylistStore((s) => s.removeSongs);
  const addFavorites = useFavoriteStore((s) => s.addFavorites);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const replaceSong = usePlaylistStore((s) => s.replaceSong);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);

  const playlist = playlists.find((p) => p.id === id);

  // 单曲换源：原位替换并持久化到歌单存储
  const handleSwap = useCallback(
    (original: Song, swapped: Song) => {
      if (playlist) replaceSong(playlist.id, original.id, swapped);
    },
    [playlist, replaceSong],
  );

  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // 头部「更多」菜单 / 导入向导弹层（wayfinder #382 定案形态）
  const [actionsVisible, setActionsVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  /** 删除后 store 立即移除歌单，等 router.back() 落地前先渲染空壳，避免闪「歌单不存在」 */
  const [deleting, setDeleting] = useState(false);

  const handleRemoveSong = useCallback(
    (song: Song) => {
      Alert.alert('移除歌曲', '确定要从歌单移除「' + song.name + '」吗？', [
        { text: '取消', style: 'cancel' },
        {
          text: '移除',
          style: 'destructive',
          onPress: () => removeSong(playlist!.id, song.id),
        },
      ]);
    },
    [playlist, removeSong],
  );

  const handleRename = useCallback(() => {
    if (!playlist) return;
    setRenameValue(playlist.name);
    setRenameModalVisible(true);
  }, [playlist]);

  const handleRenameConfirm = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !playlist) return;
    renamePlaylist(playlist.id, trimmed);
    setRenameModalVisible(false);
  };

  // 删除：二次确认 → 删 → 回歌单列表（列表页长按删除保留，见 #382）
  const handleDelete = useCallback(() => {
    if (!playlist) return;
    setActionsVisible(false);
    Alert.alert('删除歌单', '确定要删除「' + playlist.name + '」吗？歌单内的歌曲不会被删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          setDeleting(true);
          deletePlaylist(playlist.id);
          router.back();
        },
      },
    ]);
  }, [playlist, deletePlaylist]);

  const openImport = useCallback(() => {
    setActionsVisible(false);
    setImportVisible(true);
  }, []);

  // ── 选择模式（#490）────────────────────────────────────────────────────────
  // 状态收在一个对象里：模式与已选集合必须同时变化（见 components/playlistSelection.ts）。
  const [selection, setSelection] = useState<PlaylistSelection>(NO_SELECTION);
  // 已选曲目取**当前完整列表**的交集（按列表顺序），批量写入的顺序因此可预期
  const selectedSongs = useMemo(
    () => (playlist ? pickSelected(playlist.songs, selection) : []),
    [playlist, selection],
  );
  /** 批量「加入歌单」的目标：非 null 时打开现成选择器的 songs 形态（不另做第二个选择器） */
  const [addTargets, setAddTargets] = useState<Song[] | null>(null);

  const handleLongPressSong = useCallback((song: Song) => {
    setSelection((cur) => enterSelection(cur, song.id));
  }, []);

  const handleToggleSong = useCallback((song: Song) => {
    setSelection((cur) => toggleSelection(cur, song.id));
  }, []);

  const handleExitSelection = useCallback(() => setSelection(NO_SELECTION), []);

  // 全选 / 取消全选作用于 playlist.songs（完整列表），与 FlatList 的可见窗口无关
  const handleToggleSelectAll = useCallback(() => {
    setSelection((cur) => {
      const songs = playlist?.songs ?? [];
      return areAllSelected(cur, songs) ? deselectAll() : selectAll(songs.map((s) => s.id));
    });
  }, [playlist]);

  // 返回键先退出选择模式（Android 硬件返回），再轮到页面返回
  useFocusEffect(
    useCallback(() => {
      if (!selection.mode) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setSelection(NO_SELECTION);
        return true;
      });
      return () => sub.remove();
    }, [selection.mode]),
  );

  const handleBatchRemove = useCallback(() => {
    if (!playlist || selectedSongs.length === 0) return;
    const ids = selectedSongs.map((s) => s.id);
    Alert.alert('移除歌曲', `确定从歌单移除选中的 ${ids.length} 首歌曲吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          // 一次 removeSongs = 一次 set（一次持久化 + 一次渲染），绝不逐首 removeSong
          removeSongs(playlist.id, ids);
          setSelection(NO_SELECTION);
        },
      },
    ]);
  }, [playlist, removeSongs, selectedSongs]);

  const handleBatchFavorite = useCallback(() => {
    if (selectedSongs.length === 0) return;
    addFavorites(selectedSongs);
    setSelection(NO_SELECTION);
    Alert.alert('提示', `已收藏 ${selectedSongs.length} 首`);
  }, [addFavorites, selectedSongs]);

  const handleBatchDownload = useCallback(() => {
    const songs = selectedSongs;
    if (songs.length === 0) return;
    setSelection(NO_SELECTION);
    // 逐首下载是下载服务的既有粒度（并发由 downloadService 的槽位门控），
    // 这里只做一次汇总提示，不逐首弹窗
    void Promise.allSettled(songs.map((s) => downloadSong(s))).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length;
      Alert.alert(
        '批量下载',
        failed === 0
          ? `已完成 ${songs.length} 首下载`
          : `完成 ${songs.length - failed} 首，失败 ${failed} 首`,
      );
    });
  }, [selectedSongs]);

  const handleBatchAddToPlaylist = useCallback(() => {
    if (selectedSongs.length === 0) return;
    setAddTargets(selectedSongs);
  }, [selectedSongs]);

  const handleCloseAddToPlaylist = useCallback(() => {
    setAddTargets(null);
    setSelection(NO_SELECTION);
  }, []);

  if (deleting) {
    return <View style={styles.container} />;
  }

  if (!playlist) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <Stack.Screen
            options={{
              title: '歌单',
              headerShown: true,
              headerStyle: { backgroundColor: colors.bgSurface },
              headerTintColor: colors.textPrimary,
              headerShadowVisible: false,
            }}
          />
          <View style={styles.empty}>
            <CircleAlert size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>歌单不存在</Text>
          </View>
        </SafeAreaView>
        <BottomSafePlayerBar />
      </View>
    );
  }

  const moreButton = (
    <ScalePress
      style={styles.moreBtn}
      onPress={() => setActionsVisible(true)}
      hitSlop={{ left: 8, right: 8, top: 8, bottom: 8 }}
    >
      <MoreVertical size={22} color={colors.textSecondary} />
    </ScalePress>
  );

  const isEmpty = playlist.songs.length === 0;

  return (
    <View style={styles.container}>
      {/* 全出血封面方案不需要顶部安全区边距，由封面自行延伸 */}
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        {/* 空歌单没有 Hero（=没有悬浮导航栏），改用原生 header 承载返回 + 更多，否则导入入口不可达 */}
        <Stack.Screen
          options={
            isEmpty
              ? {
                  title: playlist.name,
                  headerShown: true,
                  headerRight: () => moreButton,
                  headerStyle: { backgroundColor: colors.bgSurface },
                  headerTintColor: colors.textPrimary,
                  headerShadowVisible: false,
                }
              : { title: playlist.name, headerShown: false }
          }
        />

        {isEmpty ? (
          <View style={styles.empty}>
            <Music2 size={64} color={colors.textTertiary} />
            <Text style={styles.emptyText}>歌单是空的</Text>
          </View>
        ) : (
          <PlaylistHero
            playlist={playlist}
            onRemoveSong={handleRemoveSong}
            onSwap={handleSwap}
            navRight={moreButton}
            selection={selection}
            onExitSelection={handleExitSelection}
            onLongPressSong={handleLongPressSong}
            onToggleSong={handleToggleSong}
            onToggleAll={handleToggleSelectAll}
          />
        )}

        <Modal
          visible={renameModalVisible}
          transparent
          animationType="fade"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setRenameModalVisible(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setRenameModalVisible(false)}
          >
            <Pressable
              style={styles.modalContent}
              onPress={() => {}}
            >
              <Text style={styles.modalTitle}>重命名歌单</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="输入歌单名称"
                placeholderTextColor={colors.inputPlaceholder}
                value={renameValue}
                onChangeText={setRenameValue}
                autoFocus
              />
              <View style={styles.modalActions}>
                <ScalePress
                  style={styles.cancelBtn}
                  onPress={() => {
                    setRenameValue('');
                    setRenameModalVisible(false);
                  }}
                >
                  <Text style={styles.cancelText}>取消</Text>
                </ScalePress>
                <ScalePress
                  style={[
                    styles.confirmBtn,
                    !renameValue.trim() && { opacity: opacity.disabled },
                  ]}
                  onPress={handleRenameConfirm}
                  disabled={!renameValue.trim()}
                >
                  <Text style={styles.confirmText}>确认</Text>
                </ScalePress>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* 「更多」操作面板：重命名 / 导入歌曲 / 删除歌单（对齐 SongActionsHost 的行式面板） */}
        <BottomSheet visible={actionsVisible} onClose={() => setActionsVisible(false)}>
          <View style={styles.actionsBody}>
            <Text style={styles.actionsTitle} numberOfLines={1}>{playlist.name}</Text>
            <ScalePress
              style={styles.actionItem}
              onPress={() => {
                setActionsVisible(false);
                handleRename();
              }}
            >
              <Pencil size={22} color={colors.textPrimary} />
              <Text style={styles.actionLabel}>重命名</Text>
            </ScalePress>
            <ScalePress style={styles.actionItem} onPress={openImport}>
              <Upload size={22} color={colors.textPrimary} />
              <Text style={styles.actionLabel}>导入歌曲</Text>
            </ScalePress>
            <ScalePress style={[styles.actionItem, styles.actionItemLast]} onPress={handleDelete}>
              <Trash2 size={22} color={colors.dangerText} />
              <Text style={[styles.actionLabel, styles.actionLabelDanger]}>删除歌单</Text>
            </ScalePress>
            <ScalePress style={styles.actionCancel} onPress={() => setActionsVisible(false)}>
              <Text style={styles.cancelText}>取消</Text>
            </ScalePress>
          </View>
        </BottomSheet>

        <PlaylistImportSheet
          visible={importVisible}
          playlistId={playlist.id}
          playlistName={playlist.name}
          existingSongs={playlist.songs}
          onClose={() => setImportVisible(false)}
        />

        {/* 批量加入歌单：复用行内「更多 → 加入歌单」的同一个选择器（songs 形态，一次 addSongs），
            不另做第二个弹层（#489 已给它补了就地新建歌单入口） */}
        <AddToPlaylistModal
          visible={addTargets !== null}
          songs={addTargets ?? undefined}
          onClose={handleCloseAddToPlaylist}
        />
      </SafeAreaView>
      {/* 底部操作条：紧贴放在播放栏之前 → 两者上下相接、不重叠，安全区仍归播放栏 */}
      {selection.mode ? (
        <PlaylistBatchBar
          count={selectedSongs.length}
          onAddToPlaylist={handleBatchAddToPlaylist}
          onDownload={handleBatchDownload}
          onRemove={handleBatchRemove}
          onFavorite={handleBatchFavorite}
        />
      ) : null}
      <BottomSafePlayerBar />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyText: { ...textVariants.callout, color: colors.textSecondary, marginTop: spacing[3] },

  moreBtn: { marginRight: spacing[2] },

  // 「更多」操作面板
  actionsBody: { paddingHorizontal: spacing[5], paddingBottom: spacing[5] },
  actionsTitle: {
    ...textVariants.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing[4],
    textAlign: 'center',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  actionItemLast: { borderBottomWidth: 0 },
  actionLabel: { ...textVariants.callout, color: colors.textPrimary, marginLeft: spacing[3] },
  actionLabelDanger: { color: colors.dangerText },
  actionCancel: {
    marginTop: spacing[3],
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
  },

  // modal
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    padding: spacing[6],
    width: '80%',
  },
  modalTitle: {
    ...textVariants.title,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing[4],
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...textVariants.body,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: spacing[5],
    gap: spacing[3],
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
  },
  cancelText: { ...textVariants.body, fontWeight: '400', color: colors.textSecondary },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  confirmText: { ...textVariants.body, fontWeight: '600', color: colors.textInverse },
});
