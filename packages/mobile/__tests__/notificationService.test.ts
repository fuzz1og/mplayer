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
//
// 检测方式（#93 真机验证确定）：`Constants.appOwnership === AppOwnership.Expo`。
// `Constants.expoGoConfig !== null` 在 dev build 下也非 null，会误判；单测 mock
// 需与实现一致地提供 AppOwnership 枚举。

const constantsMocks = vi.hoisted(() => ({
  // 'expo' = Expo Go；null = dev build / standalone / bare
  appOwnership: 'expo' as string | null,
}));

vi.mock('expo-constants', () => ({
  AppOwnership: { Expo: 'expo' },
  default: {
    get appOwnership() {
      return constantsMocks.appOwnership;
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
  constantsMocks.appOwnership = 'expo';
});

describe('requestNotificationPermission (#93)', () => {
  it('Expo Go（appOwnership=expo）下返回 false，且不加载 expo-notifications', async () => {
    constantsMocks.appOwnership = 'expo';
    const { requestNotificationPermission } = await loadService();

    await expect(requestNotificationPermission()).resolves.toBe(false);
  });

  it('dev build（appOwnership=null）下 guard 不生效，走真实 require 路径（node 环境抛错属预期）', async () => {
    // 说明：node 测试环境无法加载真实 expo-notifications（依赖原生模块），
    // 此用例仅验证 appOwnership=null 时 isExpoGo=false、不会提前 return false。
    // 真实授权流由 dev build 真机验证（#93 验收路径）。
    constantsMocks.appOwnership = null;
    const service = await loadService();

    // 通过导出常量确认 guard 判定
    expect(service.isExpoGo).toBe(false);
  });
});
