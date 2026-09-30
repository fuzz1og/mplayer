import { create } from 'zustand';
import { isDiagnosticsEnabled } from '../services/devMode';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  message: string;
}

const MAX_ENTRIES = 100;

/** 用户可见的瞬态通知（Toast）：error=播放最终失败等；info=试听版提示等非错误反馈 */
export interface NoticeMessage {
  level: 'info' | 'error';
  text: string;
}

interface LogsState {
  entries: LogEntry[];
  notice: NoticeMessage | null;
  addLog: (level: LogLevel, message: string) => void;
  reportError: (message: string) => void;
  setNotice: (level: 'info' | 'error', message: string) => void;
  clearLogs: () => void;
  clearNotice: () => void;
}

/**
 * 应用内日志（真机上无法看终端 console，这里做环形缓冲 + 全局错误提示）。
 * addLog 同时镜像到 console，方便有终端/DevTools 时排查。
 *
 * **级别门禁（#477）**：关开发者模式 = normal（只记 warn/error），开 = verbose（info 也记）。
 * 门禁只作用于 `entries`（诊断缓冲）这一档**详细度**：warn/error 是 release 侧看门狗与
 * 真实失败记录，永远常开；而 `notice`（用户可见 Toast）与 `entries` **解耦**——
 * `setNotice('info', …)` 在 info 不进缓冲时也必须弹（否则「试听版可换源」这类提示会随
 * 日志级别一起被吞掉）。
 */
export const useLogsStore = create<LogsState>((set, get) => ({
  entries: [],
  notice: null,

  addLog: (level, message) => {
    if (level === 'error') console.error('[player]', message);
    else if (level === 'warn') console.warn('[player]', message);
    else console.log('[player]', message);
    // info 只在诊断详细度打开时进诊断缓冲；console 镜像不受门禁（release 不剥 console）
    if (level === 'info' && !isDiagnosticsEnabled()) return;
    set((state) => ({
      entries: [...state.entries, { ts: Date.now(), level, message }].slice(-MAX_ENTRIES),
    }));
  },

  // 需要用户可见的最终错误（如队列耗尽），触发全局 Toast（error 样式）
  reportError: (message) => {
    get().addLog('error', message);
    set({ notice: { level: 'error', text: message } });
  },

  // 非错误类用户提示（如「当前为试听版，可换源」），同一 Toast 通道 info 样式。
  // Toast 与诊断缓冲解耦：info 因级别不进 entries 时，这里仍要弹。
  setNotice: (level, message) => {
    get().addLog(level, message);
    set({ notice: { level, text: message } });
  },

  clearLogs: () => set({ entries: [] }),
  clearNotice: () => set({ notice: null }),
}));
