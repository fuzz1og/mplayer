import { create } from 'zustand';
import { musicApi, getDirectClient } from '@mplayer/core';
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

/** Song → 榜单视图条目（网易能力面/QQ 旧门面统一走这里）。 */
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

/** 网易榜单：经能力面直调 getToplists，按 id（`${source}:${sourceId}`）取组。 */
async function neteaseToplistSongs(sourceId: number): Promise<Song[]> {
  const groups = await getDirectClient('netease')!.getToplists!();
  return groups.find((g) => g.id === `netease:${sourceId}`)?.songs ?? [];
}

/** QQ 榜单旧门面条目（QQ 内容迁移在后续票，#278 仅迁网易）。 */
interface QqHotlistItem {
  id: string;
  name: string;
  artists: string;
  cover: string;
  album: string;
}

/** QQ 榜单旧门面 → Song（字段对齐，rank 由上层索引推导）。 */
function qqSongsToSongs(items: QqHotlistItem[]): Song[] {
  return items.map((it) => ({
    id: it.id,
    name: it.name,
    artist: it.artists,
    album: it.album,
    cover: it.cover,
    url: '',
    lrc: '',
    duration: 0,
    sourceType: 'qq' as const,
  }));
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
        neteaseToplistSongs(3778678),
        musicApi.getQQHotlist(),
        neteaseToplistSongs(3779629),
        musicApi.getQQNewSongList(),
      ]);
      set({
        neteaseHotlist: toHotlistItems(nh).slice(0, 10),
        qqHotlist: toHotlistItems(qqSongsToSongs(qh)).slice(0, 10),
        neteaseNew: toHotlistItems(nn).slice(0, 10),
        qqNew: toHotlistItems(qqSongsToSongs(qn)).slice(0, 10),
      });
    } catch (err) {
      console.error('加载发现页失败:', err);
    } finally {
      set({ loading: false });
    }
  },
}));
