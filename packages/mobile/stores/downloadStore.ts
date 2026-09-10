import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DownloadItem {
  /** 复合键 `${sourceType}:${songId}`：跨源可能返回相同数字 id，单用 songId 会互相顶掉记录 */
  key: string;
  songId: string;
  name: string;
  artist: string;
  fileName: string;
  status: 'downloading' | 'done' | 'error';
  /** 同步到公共下载目录后的 SAF content:// uri（未同步则无） */
  publicUri?: string;
  error?: string;
  addedAt: number;
}

/**
 * 持久化的下载记录：只存状态迁移（下载中/完成/失败与文件信息）。
 * 高频进度刻意不在这里（会触发全量 JSON 序列化 + AsyncStorage 写），
 * 由瞬时的 downloadProgressStore 承担读模型。
 */
interface DownloadState {
  items: DownloadItem[];
  addItem: (item: DownloadItem) => void;
  updateStatus: (key: string, patch: Partial<Pick<DownloadItem, 'status' | 'error' | 'publicUri' | 'fileName'>>) => void;
  removeItem: (key: string) => void;
  /** 清除失败条目：下载失败已自动移除，此处清理历史残留的 error 条目（本地歌曲页挂载时调用） */
  purgeFailed: () => void;
}

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((s) => ({
          // 同名歌曲重新下载时替换旧记录（先删后加，保持顺序在前）
          items: [item, ...s.items.filter((i) => i.key !== item.key)],
        })),
      updateStatus: (key, patch) =>
        set((s) => ({
          items: s.items.map((i) => (i.key === key ? { ...i, ...patch } : i)),
        })),
      removeItem: (key) =>
        set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
      purgeFailed: () =>
        set((s) => ({ items: s.items.filter((i) => i.status !== 'error') })),
    }),
    {
      name: 'mplayer-downloads',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      /**
       * v0/v1 曾把每个进度事件一起持久化：迁移时剥掉旧记录里的 progress，
       * 进度读模型改由 downloadProgressStore 承担（不落盘）。
       */
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as { items?: Record<string, unknown>[] };
        const items = (state.items ?? []).map((item) => {
          const next = { ...item };
          delete next.progress;
          return next as unknown as DownloadItem;
        });
        return { items };
      },
    }
  )
);
