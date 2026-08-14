import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';
import type { NotificationResponse } from 'expo-notifications';
import type { Song } from '@mplayer/core';

const CHANNEL_ID = 'music-playback';
const NOTIFICATION_ID = 'music-playback';
const CATEGORY_ID = 'music-playback-controls';

// Expo Go 判定必须用 appOwnership（仅 Expo Go 返回 'expo'）：
// `Constants.expoGoConfig !== null` 在 dev build（expo-dev-client）下也非 null
// （返回整个 embedded manifest），会导致 dev build 误判为 Expo Go 而禁用通知/锁屏
// （#93 真机验证发现的 bug）。executionEnvironment=StoreClient 也包含 dev build，不可用。
export const isExpoGo = Constants.appOwnership === AppOwnership.Expo;
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

/**
 * 请求通知权限（Android 13+ 的 POST_NOTIFICATIONS 运行时权限；iOS 为
 * alert/badge/sound 授权）。Expo Go 下 expo-notifications 不可用，直接返回 false。
 * 应在首次播放或启动时调用；拒绝后系统不会自动重弹，需用户去系统设置开启。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = loadNotifications();
  if (!Notifications) return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
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
