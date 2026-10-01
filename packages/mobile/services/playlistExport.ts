import type { Song } from '@mplayer/core';

/**
 * 网络歌单 → 新的本地歌单（#492 的落库那一步）。
 *
 * 只做两件事，但正是本票的性能与正确性要点所在：
 * - **一次 `addSongs` = 一次 set = 一次持久化 + 一次渲染**（stores/playlistStore.ts 的注释即此纪律）；
 *   照抄桌面 `DiscoverPlaylistDetailPage` 的逐首 `playlist:addSong` 会变成 O(N²)。
 * - 先建后写都在这一段同步代码里，中途抛错**不会**留下一个空歌单（调用方只在拿到全量后才调它）。
 *
 * 依赖以参数注入，页面传 `usePlaylistStore.getState()` 的对应动作；
 * 单测因此可以塞入 mock，直接断言调用次数与载荷。
 */
export function exportSongsToLocalPlaylist(
  deps: {
    createPlaylist: (name: string) => string;
    addSongs: (playlistId: string, songs: Song[]) => void;
  },
  name: string,
  songs: Song[],
): string {
  const playlistId = deps.createPlaylist(name);
  deps.addSongs(playlistId, songs);
  return playlistId;
}
