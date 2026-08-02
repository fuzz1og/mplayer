import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { NotificationResponse } from 'expo-notifications';
import type { Song } from '@mplayer/core';

const CHANNEL_ID = 'music-playback';
const NOTIFICATION_ID = 'music-playback';
const CATEGORY_ID = 'music-playback-controls';

const isExpoGo = Constants.expoGoConfig !== null;
let notifications: typeof import('expo-notifications') | null = null;

function loadNotifications(): typeof import('expo-notifications') | null {
  if (isExpoGo || notifications) return notifications;

  // expo-notifications is unavailable in Expo Go on Android SDK 53+.
  const mod = require('expo-notifications') as typeof import('expo-notifications');
  notifications = mod;
  mod.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  return notifications;
}

export async function setupNotificationChannel(): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '音乐播放',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
    });
  }

  // 注册通知分类（含操作按钮）
  await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
    {
      identifier: 'prev',
      buttonTitle: '上一首',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'play-pause',
      buttonTitle: '播放/暂停',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'next',
      buttonTitle: '下一首',
      options: { opensAppToForeground: false },
    },
  ]);
}

export function addNotificationResponseListener(
  listener: (response: NotificationResponse) => void,
): { remove(): void } {
  const Notifications = loadNotifications();
  if (!Notifications) return { remove() {} };

  const sub = Notifications.addNotificationResponseReceivedListener(listener);
  return { remove: () => sub.remove() };
}

export async function updateNotification(song: Song | null, isPlaying: boolean): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;

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
      categoryIdentifier: CATEGORY_ID,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

export async function clearNotification(): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  await Notifications.dismissAllNotificationsAsync();
}
