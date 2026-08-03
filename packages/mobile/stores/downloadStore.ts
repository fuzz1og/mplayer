import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DownloadItem {
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
  updateStatus: (songId: string, patch: Partial<Pick<DownloadItem, 'status' | 'error'>>) => void;
  removeItem: (songId: string) => void;
}

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((s) => ({
          // 同名歌曲重新下载时替换旧记录（先删后加，保持顺序在前）
          items: [item, ...s.items.filter((i) => i.songId !== item.songId)],
        })),
      updateStatus: (songId, patch) =>
        set((s) => ({
          items: s.items.map((i) => (i.songId === songId ? { ...i, ...patch } : i)),
        })),
      removeItem: (songId) =>
        set((s) => ({ items: s.items.filter((i) => i.songId !== songId) })),
    }),
    {
      name: 'mplayer-downloads',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
