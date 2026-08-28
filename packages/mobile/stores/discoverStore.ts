import { create } from 'zustand';
import { getDirectClient } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';

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

/** 榜单：经能力面直调 getToplists，按 id（`${source}:${sourceId}`）取组。 */
async function toplistSongs(source: SourceKey, sourceId: number): Promise<Song[]> {
  const groups = await getDirectClient(source)!.getToplists!();
  return groups.find((g) => g.id === `${source}:${sourceId}`)?.songs ?? [];
}

const NETEASE_HOTLIST_ID = 3778678;
const NETEASE_NEW_ID = 3779629;
const QQ_HOTLIST_ID = 26; // v8 topid（qq:26 热歌榜，#279）
const QQ_NEW_ID = 27; // v8 topid（qq:27 新歌榜，#279）

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
        toplistSongs('netease', NETEASE_HOTLIST_ID),
        toplistSongs('qq', QQ_HOTLIST_ID),
        toplistSongs('netease', NETEASE_NEW_ID),
        toplistSongs('qq', QQ_NEW_ID),
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
