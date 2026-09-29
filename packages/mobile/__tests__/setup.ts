import { vi } from 'vitest';

// 方案 C：`services/nativePlayer.ts` 在模块顶层 import 'react-native' 的 AppRegistry
// （headless 补窗任务注册）。node 测试环境里 react-native 是 Flow 源码、不可解析
// → 全局给最小替身；具体用例再用 vi.mock 覆盖成「假原生模块」（见 §11.1 换 mock 面）。
vi.mock('react-native', () => ({
  AppRegistry: {
    registerHeadlessTask: vi.fn(),
    registerComponent: vi.fn(),
    runApplication: vi.fn(),
  },
  Share: { share: vi.fn(async () => ({ action: 'dismissedAction' })) },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options?.android ?? options?.default },
  NativeModules: {},
  NativeEventEmitter: class {
    addListener() {
      return { remove() {} };
    }
    removeAllListeners() {}
  },
}));

// 方案 C：`modules/native-player` 用 `requireOptionalNativeModule('MPlayerNativePlayer')` 拿桥
// （iOS/Web 无该模块 → 回落 expo-audio）。node 测试环境里没有原生模块：
// 默认返回 null（= 回落引擎路径，既有 42 例 audioPlayer 测试继续跑）；
// 需要验原生引擎的用例在自己文件里 `vi.mock('expo', ...)` 覆盖成假原生模块。
vi.mock('expo', () => ({
  requireOptionalNativeModule: () => null,
  requireNativeModule: (name: string) => {
    throw new Error(`native module ${name} is not available in tests`);
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));
