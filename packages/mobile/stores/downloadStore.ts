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
  error?: string;
  addedAt: number;
}

interface DownloadState {
  items: DownloadItem[];
  addItem: (item: DownloadItem) => void;
  updateStatus: (key: string, patch: Partial<Pick<DownloadItem, 'status' | 'error'>>) => void;
  removeItem: (key: string) => void;
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
    }),
    {
      name: 'mplayer-downloads',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
