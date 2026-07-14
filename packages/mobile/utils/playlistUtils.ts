import { Alert } from 'react-native';
import type { Song } from '@mplayer/core';
import { usePlaylistStore } from '../stores/playlistStore';

export function showAddToPlaylistPicker(song: Song): void {
  const { playlists, addSong } = usePlaylistStore.getState();
  if (playlists.length === 0) {
    Alert.alert('提示', '暂无歌单，请先在歌单页面创建', [{ text: '好的' }]);
    return;
  }
  Alert.alert(
    '加入歌单',
    undefined,
    [
      ...playlists.map((p: { id: string; name: string }) => ({
        text: p.name,
        onPress: () => {
          addSong(p.id, song);
          Alert.alert('已加入', `已加入歌单「${p.name}」`);
        },
      })),
      { text: '取消', style: 'cancel' },
    ],
  );
}
