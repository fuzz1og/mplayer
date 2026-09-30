/**
 * 桌面渲染层开发者模式（#477 B 方案第一片）。
 *
 * 与移动端 `packages/mobile/services/devMode.ts` 同形：显式开关（设置页左导航「开发者模式」）、
 * 状态跨重启保持、诊断内容默认不出现。差异只有持久层——桌面的设置项历来走主进程 IPC/文件，
 * 而本票的写权限收在渲染层（`src/renderer/**`），故这里用 localStorage：
 * 键名带 app 前缀，读写各自 try/catch，不新增依赖也**不动主进程**。
 *
 * `isDiagnosticsEnabled()` 是「详细度」总开关，不 gate 埋点存在——诊断区（trace / 日志）
 * 由设置页按 `isDevMode()` 条件渲染。
 */

const STORAGE_KEY = 'mplayer:devMode';

type DevModeListener = (enabled: boolean) => void;

const listeners = new Set<DevModeListener>();
let enabled = readStored();
let initialized = false;

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStored(next: boolean): void {
  try {
    if (next) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式 / 存储被禁：保持会话内状态即可，不因此炸设置页
  }
}

/**
 * 桌面渲染层 dev 构建判定。Vite 在构建期把 `import.meta.env.DEV` 内联成常量
 * （dev server = true，`npm run build` = false），故 release 包上恒为 false；
 * vitest 下按 test 模式取值，测试需要时直接设开关。
 */
export function isDevBuild(): boolean {
  return import.meta.env.DEV === true;
}

/** 开发者模式是否开启（用户显式开关，跨重启保持）。 */
export function isDevMode(): boolean {
  return enabled;
}

/** 诊断详细度总开关：dev 构建或用户开了开发者模式。 */
export function isDiagnosticsEnabled(): boolean {
  return isDevBuild() || isDevMode();
}

/** 设置开关并广播；落 localStorage。 */
export function setDevMode(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  writeStored(next);
  listeners.forEach((l) => l(next));
}

/** 订阅开关变化（React 侧用 useSyncExternalStore 消费）；返回退订。 */
export function subscribeDevMode(listener: DevModeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 渲染层入口处调用一次：把已落盘的开关读进模块状态（幂等）。 */
export function initDevMode(): void {
  if (initialized) return;
  initialized = true;
  enabled = readStored();
}
