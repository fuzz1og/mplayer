import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Song } from '@mplayer/core';

const CHANNEL_ID = 'music-playback';
const NOTIFICATION_ID = 'music-playback';

// 处理前台通知行为
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '音乐播放',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
    });
  }
}

export async function updateNotification(song: Song | null, isPlaying: boolean): Promise<void> {
  if (!song) {
    await clearNotification();
    return;
  }

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: song.name,
      subtitle: song.artist,
      body: isPlaying ? `${song.artist} · ${song.album}` : `已暂停 · ${song.artist}`,
      data: { songId: song.id, isPlaying },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

export async function clearNotification(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
}
