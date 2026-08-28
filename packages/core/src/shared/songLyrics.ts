import type { Song, SourceKey } from '../types/index.js';

/**
 * 歌词获取模式（双端共用，避免桌面 loadLyricsWithRetry 与移动端 PlayerOverlay
 * 的歌词决策漂移）：
 * - **网易**：歌词已内聚进直连客户端内容能力（#242 fillLyrics）——内容方法/搜索
 *   返回的 Song.lrc 即 LRC **文本**（内联），消费端直接使用，不再有取词 URL，
 *   播放期也不再按 songId 直取；lrc 为空（收藏/历史等持久化场景）时走搜索兜底，
 *   搜索返回的网易歌曲同样带内联歌词；
 * - **汽水**：直连搜索恒不带 lrc（searchSongsSoda 恒空），再搜索也拿不到 →
 *   按 trackId 直取分享页结构化歌词（getSodaLyrics）；
 * - 其余源：歌曲自带 lrc URL（取词 URL），为空才搜索补全，URL 经 getLyrics 门面拉取。
 */

/**
 * Song.lrc 是否为内联歌词文本（网易内容能力 fillLyrics 填充的 LRC）。
 * 其余源的 lrc 是取词 URL（getLyrics 按 URL 拉取），不可当文本直用。
 * sourceType 判定 + http 前缀守卫：网易侧永不产生取词 URL，其余源永不内联文本。
 */
export function isInlineLyrics(sourceType: Song['sourceType'], lrc: string): boolean {
  return sourceType === 'netease' && !!lrc && !/^https?:\/\//.test(lrc.trim());
}

/** 该源是否「搜索不带 lrc、播放期按 trackId 直取歌词」（汽水）。
 *  网易歌词已内聚进内容能力（#242），不再是 songid 直取源。 */
export function songUsesSongidLyrics(sourceType: SourceKey): boolean {
  return sourceType === 'soda';
}

/** 该源是否汽水（歌词走分享页 getSodaLyrics，区别于其他源的 URL 门面）。 */
export function isSodaSource(sourceType: SourceKey): boolean {
  return sourceType === 'soda';
}
