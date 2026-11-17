import { useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, SECTION_TAIL_PADDING } from '../../components/chromeMetrics';

import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  type GestureResponderEvent,
} from 'react-native';
import { ChevronRight, Clock, Download, Heart, ListMusic, Play, Plus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { router } from 'expo-router';
import { COVER_SIZE, type Song } from '@mplayer/core';
import { usePlaylistStore } from '../../stores/playlistStore';
import type { Playlist } from '../../stores/playlistStore';
import { useFavoriteStore } from '../../stores/favoriteStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useDownloadStore } from '../../stores/downloadStore';
import { usePlayerStore } from '../../stores/playerStore';
import { useRefreshedCover } from '../../hooks/useRefreshedCover';
import { playlistCoverSong } from '../../components/playlistCover';
import LazyCover from '../../components/LazyCover';
import { playSong } from '../../services/audioPlayer';
import { opacity, radius, spacing, textVariants } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import ScalePress, { pressScale } from '../../components/ScalePress';

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function playQueue(songs: Song[]) {
  if (songs.length === 0) return;
  usePlayerStore.getState().setQueue(songs, 0);
  playSong(songs[0]);
}

/** 收藏主卡：第一首收藏封面 + 数量 + 播放键（整卡进收藏页，播放键不冒泡）。 */
function FavoritesCard({ favorites }: { favorites: Song[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { cover, handleError } = useRefreshedCover(favorites[0] ?? null);
  const count = favorites.length;

  const handlePlay = (e?: GestureResponderEvent) => {
    e?.stopPropagation();
    playQueue(favorites);
  };

  return (
    <ScalePress
      style={styles.heroCard}
      pressScaleTo={pressScale.row}
      onPress={() => router.push('/favorites')}
      accessibilityLabel={`我喜欢的音乐，${count} 首`}
    >
      <View style={styles.heroCoverWrap}>
        {cover ? (
          <LazyCover uri={cover} style={styles.heroCover} onError={handleError} />
        ) : (
          <View style={[styles.heroCover, styles.coverFallback]}>
            <Heart size={30} color={colors.accent} />
          </View>
        )}
      </View>
      <View style={styles.heroCopy}>
        <Text style={styles.heroTitle} numberOfLines={1}>我喜欢的音乐</Text>
        <Text style={styles.heroMeta}>{count} 首 · 最近更新</Text>
      </View>
      <ScalePress
        style={[styles.heroPlay, count === 0 && { opacity: opacity.disabled }]}
        onPress={handlePlay}
        disabled={count === 0}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="播放我喜欢的音乐"
        accessibilityState={{ disabled: count === 0 }}
      >
        <Play size={18} color={colors.textInverse} fill={colors.textInverse} />
      </ScalePress>
    </ScalePress>
  );
}

/** 播放历史 / 本地歌曲：紧凑入口，图标固定在 36pt 槽位。 */
function CompactRow({
  icon: Icon,
  label,
  meta,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  meta: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <ScalePress
      style={styles.compactRow}
      pressScaleTo={pressScale.row}
      onPress={onPress}
      accessibilityLabel={`${label}，${meta}`}
    >
      <View style={styles.compactIcon}>
        <Icon size={20} color={colors.accent} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.compactName}>{label}</Text>
        <Text style={styles.rowMeta}>{meta}</Text>
      </View>
      <ChevronRight size={18} color={colors.textTertiary} />
    </ScalePress>
  );
}

/** 自建歌单行：主图只取第一首歌封面，单图裁切，不拼多图。 */
function PlaylistRow({
  playlist,
  first,
  last,
  onPress,
  onLongPress,
}: {
  playlist: Playlist;
  first: boolean;
  last: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { cover, handleError } = useRefreshedCover(playlistCoverSong(playlist.songs));

  return (
    <View style={[styles.playlistRowWrap, first && styles.groupTop, last && styles.groupBottom]}>
      <ScalePress
        style={[styles.playlistRow, !last && styles.playlistRowDivider]}
        pressScaleTo={pressScale.row}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityLabel={`${playlist.name}，${playlist.songs.length} 首`}
        accessibilityHint="长按删除歌单"
      >
        {cover ? (
          <LazyCover
            uri={cover}
            thumbSize={COVER_SIZE.row}
            style={styles.playlistCover}
            onError={handleError}
          />
        ) : (
          <View style={[styles.playlistCover, styles.coverFallback]}>
            <ListMusic size={22} color={colors.textDisabled} />
          </View>
        )}
        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>
            {playlist.name}
          </Text>
          <Text style={styles.rowMeta}>
            {playlist.songs.length} 首 · {formatDate(playlist.createdAt)}
          </Text>
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </ScalePress>
    </View>
  );
}

export default function PlaylistsPage() {
  const { colors } = useTheme();
  const animatedBg = useAnimatedBg();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const favorites = useFavoriteStore((s) => s.favorites);
  const historyCount = useHistoryStore((s) => s.history.length);
  const localCount = useDownloadStore((s) => s.items.filter((item) => item.status === 'done').length);
  // ADR-0008：首次播放前迷你播放栏隐藏，让位随之缩小
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));

  const [modalVisible, setModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  const closeCreateModal = () => {
    Keyboard.dismiss();
    setNewName('');
    setModalVisible(false);
  };

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createPlaylist(trimmed);
    closeCreateModal();
  };

  const handleDelete = (item: Playlist) => {
    Alert.alert('删除歌单', `确定要删除「${item.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deletePlaylist(item.id) },
    ]);
  };

  const renderItem = ({ item, index }: { item: Playlist; index: number }) => (
    <PlaylistRow
      playlist={item}
      first={index === 0}
      last={index === playlists.length - 1}
      onPress={() => router.push(`/playlist/${item.id}`)}
      onLongPress={() => handleDelete(item)}
    />
  );

  return (
    <Animated.View style={[styles.container, { backgroundColor: animatedBg }]}>
      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingTop: topChromeHeight(insets.top), paddingBottom: bottomChromeHeight(insets.bottom, true, playerVisible) + SECTION_TAIL_PADDING },
        ]}
        ListHeaderComponent={() => (
          <>
            <FavoritesCard favorites={favorites} />

            <View style={styles.groupCard}>
              <CompactRow
                icon={Clock}
                label="播放历史"
                meta={`${historyCount} 首`}
                onPress={() => router.push('/history')}
              />
              <View style={styles.groupDivider} />
              <CompactRow
                icon={Download}
                label="本地歌曲"
                meta={`${localCount} 首`}
                onPress={() => router.push('/download')}
              />
            </View>

            {/* 新建入口挂在它要创建的分组上，避免单独占一行；始终显示，空歌单时也有入口。 */}
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <Text style={styles.groupLabel} accessibilityRole="header">自建歌单</Text>
                <Text style={styles.groupCount}>{playlists.length}</Text>
              </View>
              <ScalePress
                style={styles.newGroupBtn}
                onPress={() => setModalVisible(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="新建歌单"
              >
                <Plus size={15} color={colors.accent} />
                <Text style={styles.newGroupText}>新建</Text>
              </ScalePress>
            </View>
          </>
        )}
      />

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={closeCreateModal}
      >
        {/* 遮罩/内容拦截器保持无动画语义（PR #260 判例）：不应有视觉反馈 */}
        <Pressable
          style={styles.modalOverlay}
          onPress={closeCreateModal}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKav}
          >
            <Pressable
              style={styles.modalContent}
              onPress={() => {}}
            >
              <Text style={styles.modalTitle}>新建歌单</Text>
              <TextInput
                style={[styles.modalInput, inputFocused && styles.modalInputFocused]}
                placeholder="输入歌单名称"
                placeholderTextColor={colors.inputPlaceholder}
                value={newName}
                onChangeText={setNewName}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleCreate}
                accessibilityLabel="新歌单名称"
              />
              <View style={styles.modalActions}>
                <ScalePress
                  style={styles.cancelBtn}
                  onPress={closeCreateModal}
                  accessibilityLabel="取消新建歌单"
                >
                  <Text style={styles.cancelText}>取消</Text>
                </ScalePress>
                <ScalePress
                  style={[
                    styles.confirmBtn,
                    !newName.trim() && { opacity: opacity.disabled },
                  ]}
                  onPress={handleCreate}
                  disabled={!newName.trim()}
                  accessibilityLabel="创建歌单"
                >
                  <Text style={styles.confirmText}>创建</Text>
                </ScalePress>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 主题切换平滑过渡（M3）：根部应用共享 Animated 背景色
  container: { flex: 1 },
  // 收藏主卡
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    marginBottom: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
  },
  heroCoverWrap: {
    width: 100,
    height: 100,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  heroCover: { width: '100%', height: '100%' },
  heroCopy: { flex: 1, marginLeft: spacing[4] },
  heroTitle: { ...textVariants.title, color: colors.textPrimary },
  heroMeta: { ...textVariants.footnote, color: colors.textSecondary, marginTop: 2 },
  heroPlay: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing[2],
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },

  // 播放历史 / 本地歌曲
  groupCard: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    overflow: 'hidden',
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  compactIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  compactName: { ...textVariants.body, color: colors.textPrimary },
  groupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginLeft: spacing[4] + 36 + spacing[3],
  },

  // 自建歌单
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  groupHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  groupLabel: { ...textVariants.footnote, fontWeight: '600', color: colors.textSecondary },
  groupCount: { ...textVariants.footnote, color: colors.textSecondary },
  newGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[1],
  },
  newGroupText: { ...textVariants.footnote, fontWeight: '600', color: colors.accent },
  // 底部让位由 contentContainerStyle 的 bottomChromeHeight 统一注入
  list: {},
  playlistRowWrap: {
    marginHorizontal: spacing[4],
    backgroundColor: colors.bgSurface,
  },
  groupTop: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  groupBottom: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: 'hidden',
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  playlistRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  playlistCover: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    marginRight: spacing[3],
  },
  rowInfo: { flex: 1 },
  rowName: { ...textVariants.body, color: colors.textPrimary },
  rowMeta: { ...textVariants.caption, color: colors.textSecondary, marginTop: spacing[1] },

  // modal
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalKav: {
    width: '100%',
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
    ...textVariants.body,
    fontWeight: '400',
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    color: colors.textPrimary,
  },
  modalInputFocused: {
    borderColor: colors.inputBorderFocus,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: spacing[5],
    gap: spacing[3],
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
  },
  cancelText: { ...textVariants.body, fontWeight: '400', color: colors.textSecondary },
  confirmBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  confirmText: { ...textVariants.body, fontWeight: '600', color: colors.textInverse },
});
