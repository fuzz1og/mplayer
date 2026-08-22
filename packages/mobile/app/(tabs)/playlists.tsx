import { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { ListMusic, ChevronRight, Plus, Heart, Clock } from 'lucide-react-native';
import { router } from 'expo-router';
import { usePlaylistStore } from '../../stores/playlistStore';
import type { Playlist } from '../../stores/playlistStore';
import {radius, textVariants} from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);

  const [modalVisible, setModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createPlaylist(trimmed);
    setNewName('');
    setModalVisible(false);
  };

  const handleDelete = (item: Playlist) => {
    Alert.alert('删除歌单', `确定要删除「${item.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deletePlaylist(item.id) },
    ]);
  };

  const renderItem = ({ item }: { item: Playlist }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() => router.push(`/playlist/${item.id}`)}
      onLongPress={() => handleDelete(item)}
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
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>我的歌单</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setModalVisible(true)}
        >
          <Plus size={24} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={() => (
          <>
            {BUILT_IN.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.row}
                activeOpacity={0.6}
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
              </TouchableOpacity>
            ))}
            {playlists.length > 0 && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={{ ...textVariants.footnote, color: colors.textSecondary }}>我的歌单</Text>
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
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalContent}
            activeOpacity={1}
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
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setNewName('');
                  setModalVisible(false);
                }}
              >
                <Text style={styles.cancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  !newName.trim() && { opacity: 0.4 },
                ]}
                onPress={handleCreate}
                disabled={!newName.trim()}
              >
                <Text style={styles.confirmText}>创建</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  title: { ...textVariants.largeTitle, color: colors.textPrimary },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingBottom: 100 },

  // rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
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
    marginRight: 12,
  },
  rowInfo: { flex: 1 },
  rowName: { ...textVariants.body, color: colors.textPrimary },
  rowMeta: { ...textVariants.caption, color: colors.textSecondary, marginTop: 3 },

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
    padding: 24,
    width: '80%',
  },
  modalTitle: {
    ...textVariants.title,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    ...textVariants.body,
    fontWeight: '400',
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
  },
  modalInputFocused: {
    borderColor: colors.inputBorderFocus,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
  },
  cancelText: { ...textVariants.body, fontWeight: '400', color: colors.textSecondary },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  confirmText: { ...textVariants.body, fontWeight: '600', color: colors.textInverse },
});
