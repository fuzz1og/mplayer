import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * 通知权限与渠道。
 * 只保留两件事：Android 13+ 的 POST_NOTIFICATIONS 运行时权限申请，以及与原生**完全同名**的通知渠道
 * （渠道属性以先创建者为准，两边必须一致）。
 */

const CHANNEL_ID = 'music-playback-native';
const CHANNEL_NAME = '正在播放';

// Expo Go 判定必须用 appOwnership（仅 Expo Go 返回 'expo'）：`Constants.expoGoConfig !== null` 与
// `executionEnvironment=StoreClient` 在 dev build 下也成立，会误判为 Expo Go 而禁用通知/锁屏（#93 真机验证发现的 bug）。
export const isExpoGo = Constants.appOwnership === AppOwnership.Expo;
let notifications: typeof import('expo-notifications') | null = null;

function loadNotifications(): typeof import('expo-notifications') | null {
  if (isExpoGo || notifications) return notifications;

  // expo-notifications is unavailable in Expo Go on Android SDK 53+.
  const mod = require('expo-notifications') as typeof import('expo-notifications');
  notifications = mod;
  return notifications;
}

/**
 * 申请通知权限（alert/badge/sound 授权）。Expo Go 下 expo-notifications 不可用，直接返回 false。
 * 注意：媒体会话通知（media3）在 POST_NOTIFICATIONS 被拒时**仍可见**（官方豁免），但 FGS 通知不豁免 → 仍要主动申请。
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

/**
 * 原 `music-playback`（IMPORTANCE_HIGH）已废弃：渠道属性以先创建者为准，复用旧渠道会让通知「突然变
 * 吵/变安静」，且与 media3 默认不一致。
 */
export async function setupNotificationChannel(): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: CHANNEL_NAME,
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
  });
}
