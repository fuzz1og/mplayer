import { create } from 'zustand';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  message: string;
}

const MAX_ENTRIES = 100;

interface LogsState {
  entries: LogEntry[];
  lastError: string | null;
  addLog: (level: LogLevel, message: string) => void;
  reportError: (message: string) => void;
  clearLogs: () => void;
  clearLastError: () => void;
}

/**
 * 应用内日志（真机上无法看终端 console，这里做环形缓冲 + 全局错误提示）。
 * addLog 同时镜像到 console，方便有终端/DevTools 时排查。
 */
export const useLogsStore = create<LogsState>((set, get) => ({
  entries: [],
  lastError: null,

  addLog: (level, message) => {
    if (level === 'error') console.error('[player]', message);
    else if (level === 'warn') console.warn('[player]', message);
    else console.log('[player]', message);
    set((state) => ({
      entries: [...state.entries, { ts: Date.now(), level, message }].slice(-MAX_ENTRIES),
    }));
  },

  // 需要用户可见的最终错误（如队列耗尽），触发全局 Toast
  reportError: (message) => {
    get().addLog('error', message);
    set({ lastError: message });
  },

  clearLogs: () => set({ entries: [] }),
  clearLastError: () => set({ lastError: null }),
}));
