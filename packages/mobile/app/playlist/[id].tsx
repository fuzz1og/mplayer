import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScalePress from '../../components/ScalePress';
import { CircleAlert, MoreVertical, Music2, Pencil, Trash2, Upload } from 'lucide-react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { usePlaylistStore } from '../../stores/playlistStore';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import PlaylistHero from '../../components/PlaylistHero';
import BottomSheet from '../../components/BottomSheet';
import PlaylistImportSheet from '../../components/PlaylistImportSheet';
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
      </SafeAreaView>
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
