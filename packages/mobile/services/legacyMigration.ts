import { clearLegacyDeadResources } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { useFavoriteStore } from '../stores/favoriteStore';
import { useHistoryStore } from '../stores/historyStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { useLogsStore } from '../stores/logsStore';

/**
 * 存量数据迁移（对齐桌面 9725a60，幂等可重跑）：
 * 自建 API 退役后，收藏/历史/歌单里持久化的 `api.php?get=*` 旧签名
 * url/cover/lrc 全部是死链，会抢先命中刷新/播放流程。启动时清掉死链
 * 三件套与过期预测徽标（audioTag/nonFull），**不删除任何条目本身**；
 * 清空的字段由现解析链（resolvePlayableSongRouted / 兜底搜索）重新补全。
 */

/** 就地清理单首：死链三件套 + 过期预测徽标；返回是否有改动 */
function cleanSong(song: Song): boolean {
  let changed = clearLegacyDeadResources(song);
  if (song.audioTag !== undefined) {
    delete song.audioTag;
    changed = true;
  }
  if (song.nonFull !== undefined) {
    delete song.nonFull;
    changed = true;
  }
  return changed;
}

function migrateLegacySongs(): void {
  let cleaned = 0;

  const { favorites } = useFavoriteStore.getState();
  let favDirty = false;
  for (const s of favorites) {
    if (cleanSong(s)) {
      cleaned++;
      favDirty = true;
    }
  }
  if (favDirty) useFavoriteStore.setState({ favorites: [...favorites] });

  const { history } = useHistoryStore.getState();
  let histDirty = false;
  for (const s of history) {
    if (cleanSong(s)) {
      cleaned++;
      histDirty = true;
    }
  }
  if (histDirty) useHistoryStore.setState({ history: [...history] });

  const { playlists } = usePlaylistStore.getState();
  let plDirty = false;
  for (const p of playlists) {
    for (const s of p.songs) {
      if (cleanSong(s)) {
        cleaned++;
        plDirty = true;
      }
    }
  }
  if (plDirty) usePlaylistStore.setState({ playlists: [...playlists] });

  // N=0 也记：真机上确认迁移跑过（幂等，二次启动应为 0）
  useLogsStore.getState().addLog('info', `存量数据迁移完成: 清理 ${cleaned} 首旧签名死链`);
}

/** 启动接线：各 persist store rehydrate 完成后各跑一次（幂等） */
export function setupLegacyMigration(): void {
  const stores = [useFavoriteStore, useHistoryStore, usePlaylistStore];
  for (const store of stores) {
    const run = () => migrateLegacySongs();
    if (store.persist.hasHydrated()) run();
    else store.persist.onFinishHydration(run);
  }
}
