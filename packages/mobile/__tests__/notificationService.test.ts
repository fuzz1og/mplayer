import { afterEach, describe, expect, it, vi } from 'vitest';

// #93：通知权限请求的 Expo Go guard
//
// 设计说明：notificationService 用 CJS `require('expo-notifications')` 懒加载
// （Expo Go 下不加载该模块，避免 Android SDK 53+ Expo Go 报错）。vitest 的
// vi.mock 只拦截 ESM import，无法拦截源码内的 require——因此 dev build 分支
// （真实调用 requestPermissionsAsync）在单测中不可 mock，交给 #93 的
// dev build + 真机验收路径验证（expo run:android + OnePlus PKB110）。
// 单测聚焦 guard：Expo Go 下 requestNotificationPermission 必须安全返回 false，
// 不加载 expo-notifications、不抛错。

const constantsMocks = vi.hoisted(() => ({
  // 非 null = Expo Go
  expoGoConfig: {} as Record<string, unknown> | null,
}));

vi.mock('expo-constants', () => ({
  default: {
    get expoGoConfig() {
      return constantsMocks.expoGoConfig;
    },
  },
}));

// notificationService 顶层 import 了 react-native 的 Platform（node 环境无法解析 RN 源码）
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

async function loadService() {
  vi.resetModules();
  return await import('../services/notificationService');
}

afterEach(() => {
  vi.clearAllMocks();
  constantsMocks.expoGoConfig = {};
});

describe('requestNotificationPermission (#93)', () => {
  it('Expo Go 下返回 false，且不加载 expo-notifications', async () => {
    constantsMocks.expoGoConfig = { expoGoSDKVersion: '57.0.0' };
    const { requestNotificationPermission } = await loadService();

    await expect(requestNotificationPermission()).resolves.toBe(false);
  });
});
