import { create } from 'zustand';
import { getToplistSongs, TOPLIST_SOURCE_IDS } from '@mplayer/core';
import type { Song } from '@mplayer/core';

/** 发现页榜单条目视图（rank 由索引推导，#239）。 */
export interface HotlistItem {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

/** Song → 榜单视图条目（榜单各源统一经能力面 getToplists 返回 Song）。 */
function toHotlistItems(songs: Song[]): HotlistItem[] {
  return songs.map((s, i) => ({
    id: s.id,
    name: s.name,
    artists: s.artist,
    rank: i + 1,
    cover: s.cover,
    album: s.album,
  }));
}

// 发现页四条榜单腿的 id/取组均出自 core（TOPLIST_SOURCE_IDS + getToplistSongs，#286），本地不维护字面量
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
        getToplistSongs('netease', TOPLIST_SOURCE_IDS.netease.hot),
        getToplistSongs('qq', TOPLIST_SOURCE_IDS.qq.hot),
        getToplistSongs('netease', TOPLIST_SOURCE_IDS.netease.new),
        getToplistSongs('qq', TOPLIST_SOURCE_IDS.qq.new),
      ]);
      set({
        neteaseHotlist: toHotlistItems(nh).slice(0, 10),
        qqHotlist: toHotlistItems(qh).slice(0, 10),
        neteaseNew: toHotlistItems(nn).slice(0, 10),
        qqNew: toHotlistItems(qn).slice(0, 10),
      });
    } catch (err) {
      console.error('加载发现页失败:', err);
    } finally {
      set({ loading: false });
    }
  },
}));
