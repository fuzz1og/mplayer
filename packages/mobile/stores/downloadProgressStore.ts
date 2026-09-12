import { create } from 'zustand';

/**
 * 下载进度的瞬时读模型（刻意不进 persist）。
 *
 * 进度是高频值：以前每个 onProgress 都写回持久化的 items 数组，一次进度 =
 * 全量 JSON 序列化 + AsyncStorage 写 + 下载页整列表重渲染。现在进度只在这里
 * 聚合，同一 key 在节流窗口内只保留一次（进度是粗粒度读模型）；持久化的
 * downloadStore 只记录状态迁移（downloading/done/error、文件名、公共目录 uri）。
 */

/** 进度上报最小间隔（毫秒）：窗口内的中间值直接丢弃，100（完成）永远放行 */
export const PROGRESS_THROTTLE_MS = 200;

/** key → 上次上报时间；模块级持有，节流本身不该触发任何重渲染 */
const lastReportedAt = new Map<string, number>();

interface DownloadProgressState {
  /** 复合键（`${sourceType}:${songId}`）→ 0..100 */
  progressByKey: Record<string, number>;
  /**
   * 上报一次进度（0..100）。节流窗口内的中间值丢弃；100 永远放行，
   * 保证完成态不会停在旧进度上。
   */
  reportProgress: (key: string, progress: number) => void;
  /** 清理某个 key 的进度（完成/失败/删除/重新下载前） */
  clearProgress: (key: string) => void;
  /** 清空全部 */
  reset: () => void;
}

export const useDownloadProgressStore = create<DownloadProgressState>((set) => ({
  progressByKey: {},

  reportProgress: (key, progress) => {
    const now = Date.now();
    const last = lastReportedAt.get(key);
    if (last !== undefined && progress < 100 && now - last < PROGRESS_THROTTLE_MS) return;
    lastReportedAt.set(key, now);
    set((state) =>
      state.progressByKey[key] === progress
        ? state
        : { progressByKey: { ...state.progressByKey, [key]: progress } }
    );
  },

  clearProgress: (key) => {
    lastReportedAt.delete(key);
    set((state) => {
      if (!(key in state.progressByKey)) return state;
      const next = { ...state.progressByKey };
      delete next[key];
      return { progressByKey: next };
    });
  },

  reset: () => {
    lastReportedAt.clear();
    set({ progressByKey: {} });
  },
}));
