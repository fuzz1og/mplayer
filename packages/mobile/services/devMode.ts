/**
 * 开发者模式（#477 B 方案第一片）与诊断分级的**单一判定点**。
 *
 * 三个概念在这里收口，别在调用点各写各的：
 *   - `isDevMode()` 用户显式开关（设置页「开发者模式」行），状态存 `settingsStore.devMode`，
 *     沿用既有 AsyncStorage persist（key `settings-storage`），**不新增依赖**；
 *   - `isDevBuild()` 构建期 `__DEV__`——原先私藏在 dragJankProbe 里，这里提成共享实现；
 *   - `isDiagnosticsEnabled() = isDevBuild() || isDevMode()`：**诊断能力**（trace 采集、
 *     直链调试打印、开发者面板）的总开关。
 *
 * 与日志级别的关系（见 stores/logsStore）：`isDiagnosticsEnabled()` 决定「详细度」
 * （info 级是否进缓冲），**不决定埋点是否存在**——perfMonitor / coverDiagnostics 的
 * warn/error 档与用户可见 Toast（notice）一律常开，关掉等于从用户身上删能力。
 */
import { useSettingsStore } from '../stores/settingsStore';

declare const __DEV__: boolean;

type DevModeListener = (enabled: boolean) => void;

const listeners = new Set<DevModeListener>();
let lastNotified = false;

/**
 * dev 构建判定。vitest 的 node 环境没有 `__DEV__`（RN 运行时才注入），
 * 裸读会 ReferenceError，故走 typeof。**全仓唯一读 `__DEV__` 的地方**。
 */
export function isDevBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/** 开发者模式是否开启（用户显式开关，跨重启保持）。 */
export function isDevMode(): boolean {
  return useSettingsStore.getState().devMode === true;
}

/** 诊断能力总开关：dev 构建或用户开了开发者模式。 */
export function isDiagnosticsEnabled(): boolean {
  return isDevBuild() || isDevMode();
}

/** 设置开关。落 `settingsStore`，persist 中间件负责 AsyncStorage 落盘。 */
export function setDevMode(enabled: boolean): void {
  useSettingsStore.getState().setDevMode(enabled);
}

/**
 * 订阅开关变化（面板按需订阅；返回退订）。
 * 设一个模块级 `lastNotified` 去重，避免 store 无关变更（如切主题）也惊动订阅者。
 */
export function subscribeDevMode(listener: DevModeListener): () => void {
  listeners.add(listener);
  lastNotified = isDevMode();
  const unsubscribeStore = useSettingsStore.subscribe((state) => {
    const enabled = state.devMode === true;
    if (enabled === lastNotified) return;
    lastNotified = enabled;
    listeners.forEach((l) => l(enabled));
  });
  return () => {
    listeners.delete(listener);
    unsubscribeStore();
  };
}
