/**
 * 桌面渲染层日志环形缓冲（#477）。桌面此前**没有**任何应用内日志缓冲
 * （`docs/wayfinder/2026-09-21-t5-playback-chain-baseline.md` 原文「桌面没有对应物」），
 * 而 release 构建**不剥 console**（双重闭合的证据见 issue #477 §①），
 * 缺的只是「开关」与「读取入口」。
 *
 * 实现取向：**全局捕获 console，零调用点改动**——不改任何现有 `console.*` 调用，
 * 只在入口 import 本模块一次即开始记录。容量按需求取小（约 30 行）：这是「最近发生了什么」
 * 的现场，不是完整日志系统（桌面主进程日志采集明确不在本片）。
 *
 * 门禁：只在 `isDiagnosticsEnabled()` 打开时记录；关闭时 console 原样放行、零缓冲。
 */
import { isDiagnosticsEnabled } from './devMode';

/** 环形缓冲容量：约 30 行，够看「刚才那一下」。 */
export const RENDERER_LOG_MAX = 30;

export type RendererLogLevel = 'log' | 'info' | 'warn' | 'error';

export interface RendererLogEntry {
  ts: number;
  level: RendererLogLevel;
  message: string;
}

/**
 * 模块加载时抓一次的原始 console 方法：只用于**复位**（测试拆卸把 console 还原干净）。
 * 安装时以「当时的 console[level]」为链底（见 installRendererLogCapture），
 * 所以包装器仍会把日志转发给它上面那一层。
 */
const pristineConsole: Partial<Record<RendererLogLevel, (...args: unknown[]) => void>> =
  typeof console === 'undefined'
    ? {}
    : { log: console.log, info: console.info, warn: console.warn, error: console.error };

const buffer: RendererLogEntry[] = [];
const listeners = new Set<() => void>();
let installed = false;
/** 稳定快照引用：`useSyncExternalStore` 的 getSnapshot 必须返回同一引用直到真的变了，
 *  否则每次 render 都判「变了」→ 无限重渲染。 */
let snapshot: RendererLogEntry[] = [];
let version = 0;

function publish(): void {
  snapshot = buffer.slice();
  version += 1;
  listeners.forEach((l) => l());
}

/** 参数序列化成一行（对象走 JSON，失败退 String）。 */
function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function record(level: RendererLogLevel, args: unknown[]): void {
  if (!isDiagnosticsEnabled()) return;
  buffer.push({ ts: Date.now(), level, message: args.map(formatArg).join(' ') });
  if (buffer.length > RENDERER_LOG_MAX) buffer.splice(0, buffer.length - RENDERER_LOG_MAX);
  publish();
}

/** 安装全局 console 捕获（幂等）。由 `main.tsx` 在渲染层入口调用一次。 */
export function installRendererLogCapture(): void {
  if (installed || typeof console === 'undefined') return;
  installed = true;
  (['log', 'info', 'warn', 'error'] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original(...args);
    };
  });
}

/** 当前日志快照（稳定引用，最新在后）。 */
export function listRendererLogs(): RendererLogEntry[] {
  return snapshot;
}

/** 订阅缓冲变化（React 侧用 useSyncExternalStore 消费）。 */
export function subscribeRendererLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 快照版本号（诊断/测试用）。 */
export function getRendererLogsVersion(): number {
  return version;
}

/** 清空缓冲。 */
export function clearRendererLogs(): void {
  if (buffer.length === 0) return;
  buffer.length = 0;
  publish();
}

/** 测试用：清空缓冲、把 console 复位到模块加载时的原始方法，并允许重新安装。 */
export function __resetRendererLogStore(): void {
  if (typeof console !== 'undefined') {
    (['log', 'info', 'warn', 'error'] as const).forEach((level) => {
      const original = pristineConsole[level];
      if (original) console[level] = original;
    });
  }
  buffer.length = 0;
  snapshot = [];
  version = 0;
  installed = false;
}
