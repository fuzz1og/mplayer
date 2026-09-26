import type { Song, SourceKey } from '../types/index.js';

/**
 * 歌词获取模式（双端共用，避免桌面 loadLyricsWithRetry 与移动端 PlayerOverlay
 * 的歌词决策漂移）：
 * - **网易 / 汽水**：`songUsesSongidLyrics` 为真——歌词**按源内 ID 直取**，不靠搜索、
 *   也不靠列表内联。网易走 `musicApi.getNeteaseLyrics(songId)`（#409 取代 #242 的
 *   列表内联批量取词：内容方法不再带 lrc），汽水走 `getSodaLyrics(trackId)`（分享页）。
 * - **其余源**：歌曲自带 lrc URL（取词 URL），为空才搜索补全，URL 经 getLyrics 门面拉取。
 *
 * 历史包袱：**存量持久化数据**（收藏/历史/本地歌单）里网易的 `lrc` 可能是 #409 之前
 * 写入的内联 LRC 文本。`isInlineLyrics` 就是为这类数据保留的守卫——消费端必须先问它，
 * 命中的直接当文本用，不要当 URL 去 getLyrics。
 */

/**
 * Song.lrc 是否为内联歌词文本（#409 之前由网易内容能力填充的 LRC）。
 *
 * 现在**只可能来自存量持久化数据**：新写入的列表结果里网易 lrc 恒为空。
 * 其余源的 lrc 是取词 URL（getLyrics 按 URL 拉取），不可当文本直用。
 * sourceType 判定 + http 前缀守卫：网易侧永不产生取词 URL，其余源永不内联文本。
 */
export function isInlineLyrics(sourceType: Song['sourceType'], lrc: string): boolean {
  return sourceType === 'netease' && !!lrc && !/^https?:\/\//.test(lrc.trim());
}

/** 该源是否「歌词按源内 ID 直取、搜索拿不到」（网易 #409 / 汽水）。
 *  为真时：列表结果 lrc 恒空，播放期由消费端按 ID 直取；搜索补全无意义（还会多打一次请求）。 */
export function songUsesSongidLyrics(sourceType: SourceKey): boolean {
  return sourceType === 'netease' || sourceType === 'soda';
}

/** 该源是否汽水（歌词走分享页 getSodaLyrics，区别于网易的 songId 直取门面）。 */
export function isSodaSource(sourceType: SourceKey): boolean {
  return sourceType === 'soda';
}
