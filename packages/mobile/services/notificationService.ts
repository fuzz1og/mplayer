import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * 通知权限与渠道。
 *
 * 方案 C（规格 §8.4 / §12 R10）：通知栏与锁屏**由原生 media3 会话承载**
 * （`expo.modules.mplayerplayer.PlayerService` + `DefaultMediaNotificationProvider`），
 * 所以 JS 侧的通知体、动作按钮、响应监听**全部撤掉**——否则 Android 上会同时
 * 出现两条媒体通知，且 JS 按钮在后台根本收不到回调（#405 的根因之一）。
 *
 * 只保留两件事：Android 13+ 的 POST_NOTIFICATIONS 运行时权限申请，以及
 * 与原生**完全同名**的通知渠道（渠道属性以先创建者为准，两边必须一致）。
 */

const CHANNEL_ID = 'music-playback-native';
const CHANNEL_NAME = '正在播放';

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
  return notifications;
}

/**
 * 请求通知权限（Android 13+ 的 POST_NOTIFICATIONS 运行时权限；iOS 为
 * alert/badge/sound 授权）。Expo Go 下 expo-notifications 不可用，直接返回 false。
 * 应在首次播放或启动时调用；拒绝后系统不会自动重弹，需用户去系统设置开启。
 *
 * 注意：媒体会话通知（media3）在 POST_NOTIFICATIONS 被拒时**仍可见**（官方豁免），
 * 但 FGS 通知不豁免 → 仍然要主动申请。
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
 * 与原生 `DefaultMediaNotificationProvider` 使用同一个渠道 id
 * （`music-playback-native`，IMPORTANCE_LOW，与 media3 默认一致）。
 *
 * 原 `music-playback`（IMPORTANCE_HIGH）已废弃：渠道属性以先创建者为准，
 * 复用旧渠道会让通知「突然变吵/变安静」，且与 media3 默认不一致。
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
