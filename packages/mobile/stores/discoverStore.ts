import { create } from 'zustand';
import { musicApi } from '@mplayer/core';

export interface HotlistItem {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

interface DiscoverState {
  neteaseHotlist: HotlistItem[];
  qqHotlist: HotlistItem[];
  neteaseNew: HotlistItem[];
  qqNew: HotlistItem[];
  loading: boolean;
  load: () => Promise<void>;
}

export const useDiscoverStore = create<DiscoverState>((set) => ({
  neteaseHotlist: [],
  qqHotlist: [],
  neteaseNew: [],
  qqNew: [],
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const [nh, qh, nn, qn] = await Promise.all([
        musicApi.getNeteaseHotlist(),
        musicApi.getQQHotlist(),
        musicApi.getNeteaseNewSongList(),
        musicApi.getQQNewSongList(),
      ]);
      set({
        neteaseHotlist: nh.slice(0, 10),
        qqHotlist: qh.slice(0, 10),
        neteaseNew: nn.slice(0, 10),
        qqNew: qn.slice(0, 10),
      });
    } catch (err) {
      console.error('加载发现页失败:', err);
    } finally {
      set({ loading: false });
    }
  },
}));
