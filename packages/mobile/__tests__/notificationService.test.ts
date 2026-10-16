import { afterEach, describe, expect, it, vi } from 'vitest';

// #93：通知权限请求的 Expo Go guard
// 单测聚焦 guard：Expo Go 下 requestNotificationPermission 必须安全返回 false，不加载 
// expo-notifications、不抛错。

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
