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
} from 'react-native';
import { ListMusic, ChevronRight, Plus, Heart, Clock } from 'lucide-react-native';
import { router } from 'expo-router';
import { usePlaylistStore } from '../../stores/playlistStore';
import type { Playlist } from '../../stores/playlistStore';
import { usePlayerStore } from '../../stores/playerStore';
import {opacity, radius, spacing, textVariants} from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import ScalePress, { pressScale } from '../../components/ScalePress';

const BUILT_IN = [
  { key: 'favorites', icon: Heart, label: '收藏', desc: '我喜欢的歌曲' },
  { key: 'history', icon: Clock, label: '播放历史', desc: '最近播放的歌曲' },
];

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PlaylistsPage() {
  const { colors } = useTheme();
  const animatedBg = useAnimatedBg();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  // ADR-0008：首次播放前迷你播放栏隐藏，让位随之缩小
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);

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

  const renderItem = ({ item }: { item: Playlist }) => (
    <ScalePress
      style={styles.row}
      pressScaleTo={pressScale.row}
      onPress={() => router.push(`/playlist/${item.id}`)}
      onLongPress={() => handleDelete(item)}
      accessibilityHint="长按删除歌单"
    >
      <View style={styles.iconWrap}>
        <ListMusic size={24} color={colors.accent} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.rowMeta}>
          {item.songs.length} 首 · {formatDate(item.createdAt)}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.textTertiary} />
    </ScalePress>
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
            {/* 页头随内容滚动、从悬浮 TopBar 下穿过（M2）；静态放列表外会被 TopBar 盖住。
                用紧凑标题（17/700）：发现页移除可见页头后，各 tab 不再在内容区重复大页名。 */}
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">我的歌单</Text>
              <ScalePress
                style={styles.addBtn}
                onPress={() => setModalVisible(true)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityLabel="新建歌单"
              >
                <Plus size={24} color={colors.textInverse} />
              </ScalePress>
            </View>
            {BUILT_IN.map((item) => (
              <ScalePress
                key={item.key}
                style={styles.row}
                pressScaleTo={pressScale.row}
                onPress={() => router.push(item.key === 'favorites' ? '/favorites' : '/history')}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.bgHover }]}>
                  <item.icon size={24} color={colors.accent} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>{item.label}</Text>
                  <Text style={styles.rowMeta}>{item.desc}</Text>
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </ScalePress>
            ))}
            {playlists.length > 0 && (
              <View style={styles.groupHeader}>
                <Text style={styles.groupLabel} accessibilityRole="header">自建歌单</Text>
              </View>
            )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
  },
  // 紧凑标题：组标签已承担层级，不再用 largeTitle 重复压一层页名
  title: { ...textVariants.title, color: colors.textPrimary },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupHeader: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  groupLabel: { ...textVariants.footnote, fontWeight: '600', color: colors.textSecondary },
  // 底部让位由 contentContainerStyle 的 bottomChromeHeight 统一注入
  list: {},

  // rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
    justifyContent: 'center',
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
