import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleAlert, Pencil, Music2 } from 'lucide-react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { usePlaylistStore } from '../../stores/playlistStore';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import PlaylistHero from '../../components/PlaylistHero';
import type { Song } from '@mplayer/core';
import { colors, radius, spacing, textVariants } from '../../theme/tokens';

export default function PlaylistDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlists = usePlaylistStore((s) => s.playlists);
  const removeSong = usePlaylistStore((s) => s.removeSong);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const replaceSong = usePlaylistStore((s) => s.replaceSong);

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

  const handleRemoveSong = useCallback(
    (song: Song) => {
      Alert.alert('移除歌曲', `确定要从歌单移除「${song.name}」吗？`, [
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

  return (
    <View style={styles.container}>
      {/* 全出血封面方案不需要顶部安全区边距，由封面自行延伸 */}
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        <Stack.Screen
          options={{
            title: playlist.name,
            headerShown: false,
            headerStyle: { backgroundColor: colors.bgSurface },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerRight: () => (
              <TouchableOpacity onPress={handleRename} style={{ marginRight: spacing[1] }}>
                <Pencil size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            ),
          }}
        />

        {playlist.songs.length === 0 ? (
          <View style={styles.empty}>
            <Music2 size={64} color={colors.textTertiary} />
            <Text style={styles.emptyText}>歌单是空的</Text>
          </View>
        ) : (
          <PlaylistHero
            playlist={playlist}
            onRemoveSong={handleRemoveSong}
            onSwap={handleSwap}
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
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setRenameModalVisible(false)}
          >
            <TouchableOpacity
              style={styles.modalContent}
              activeOpacity={1}
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
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setRenameValue('');
                    setRenameModalVisible(false);
                  }}
                >
                  <Text style={styles.cancelText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.confirmBtn,
                    !renameValue.trim() && { opacity: 0.4 },
                  ]}
                  onPress={handleRenameConfirm}
                  disabled={!renameValue.trim()}
                >
                  <Text style={styles.confirmText}>确认</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
      <BottomSafePlayerBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyText: { ...textVariants.callout, color: colors.textSecondary, marginTop: spacing[3] },

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
