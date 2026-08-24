import type { Song } from '../types/index.js';

/**
 * 歌词获取模式（双端共用，避免桌面 loadLyricsWithRetry 与移动端 PlayerOverlay
 * 的歌词决策漂移）：
 * - netease / soda 直连搜索的歌曲不带 lrc 字段（searchSongsSoda 恒空），再搜索
 *   也拿不到 → 按 songid 直取：netease 走 getLyricsBySongId、soda 走
 *   getSodaLyrics（分享页免登录结构化歌词）；
 * - 其余源：歌曲自带 lrc URL 优先，为空才搜索补全。
 */

/** 该源是否「搜索不带 lrc、按 songid 直取歌词」（网易/汽水）。 */
export function songUsesSongidLyrics(sourceType: Song['sourceType']): boolean {
  return sourceType === 'netease' || sourceType === 'soda';
}

/** 该源是否汽水（歌词走分享页 getSodaLyrics，区别于网易 songid 歌词端点）。 */
export function isSodaSource(sourceType: Song['sourceType']): boolean {
  return sourceType === 'soda';
}
