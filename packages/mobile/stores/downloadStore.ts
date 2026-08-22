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
  /** 下载进度 0..100；未知总量时按已收字节估算（core），完成置 100 */
  progress?: number;
  /** 同步到公共下载目录后的 SAF content:// uri（未同步则无） */
  publicUri?: string;
  error?: string;
  addedAt: number;
}

interface DownloadState {
  items: DownloadItem[];
  addItem: (item: DownloadItem) => void;
  updateStatus: (key: string, patch: Partial<Pick<DownloadItem, 'status' | 'error' | 'publicUri' | 'fileName' | 'progress'>>) => void;
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
    }
  )
);
