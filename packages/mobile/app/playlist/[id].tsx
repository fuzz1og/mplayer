import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleAlert, Pencil, Music2 } from 'lucide-react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { usePlaylistStore } from '../../stores/playlistStore';
import SongRow from '../../components/SongRow';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import { PlaylistHeroPrototype, PrototypeSwitcher, VariantD } from '../../components/prototype/PlaylistHeroPrototype';
import type { HeroVariant } from '../../components/prototype/PlaylistHeroPrototype';
import type { Song } from '@mplayer/core';
import { colors, radius, spacing, statusBarStyle } from '../../theme/tokens';

export default function PlaylistDetailPage() {
  const { id, variant: variantParam } = useLocalSearchParams<{ id: string; variant?: string }>();
  const variantParamStr = Array.isArray(variantParam) ? variantParam[0] : variantParam;
  const variant: HeroVariant =
    variantParamStr === 'B' ? 'B' : variantParamStr === 'C' ? 'C' : variantParamStr === 'D' ? 'D' : 'A';
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
      {/* D 变体（全出血封面）不需要顶部安全区边距，由封面自行延伸 */}
      <SafeAreaView edges={__DEV__ && variant === 'D' ? [] : ['top']} style={{ flex: 1 }}>
        <StatusBar style={__DEV__ && (variant === 'B' || variant === 'D') ? 'light' : statusBarStyle} />
        <Stack.Screen
          options={{
            title: playlist.name,
            headerShown: !(__DEV__ && (variant === 'B' || variant === 'D')),
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
        ) : __DEV__ && variant === 'D' ? (
          <VariantD
            playlist={playlist}
            onRemoveSong={handleRemoveSong}
            onSwap={handleSwap}
          />
        ) : (
          <FlatList
            data={playlist.songs}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={
              __DEV__ ? (
                <PlaylistHeroPrototype playlist={playlist} variant={variant} />
              ) : null
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={1}
                onLongPress={() => handleRemoveSong(item)}
              >
                <SongRow song={item} showSource queueSongs={playlist.songs} onSwap={handleSwap} />
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.list}
          />
        )}

        {__DEV__ && <PrototypeSwitcher current={variant} />}

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
  list: { paddingBottom: 100 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyText: { color: colors.textSecondary, fontSize: 16, marginTop: spacing[3] },

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
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: spacing[4],
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
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
  cancelText: { color: colors.textSecondary, fontSize: 15 },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  confirmText: { color: colors.textInverse, fontSize: 15, fontWeight: '600' },
});
