import { isInlineLyrics, musicApi, planLyricsFetch } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { searchStrictMatch } from './songResources';

/**
 * 歌词文本取回（下载侧车用）。
 *
 * **决策在 core 单点**（`planLyricsFetch`，ADR 2026-10-04 决策 6）：与播放侧同一份语义——
 * 存量内联文本直接用；`song.lrc` 为取词 URL 走 `getLyrics`；网易/汽水按源内 ID 直取；
 * 只有「非按 ID 直取源且 lrc 为空」才搜索补全（#409 允许的唯一搜索场景）。
 * 这里只把 kind 接到具体取词实现，**失败一律返回空串**：调用方按「不可用」处理。
 */
export async function resolveLyricsText(song: Song): Promise<string> {
  const plan = planLyricsFetch(song);
  switch (plan.kind) {
    case 'inline':
      return plan.text;
    case 'url':
      return musicApi.getLyrics(plan.url).catch(() => '');
    case 'songid':
      return plan.source === 'soda'
        ? musicApi.getSodaLyrics(plan.id).catch(() => '')
        : musicApi.getNeteaseLyrics(plan.id).catch(() => '');
    case 'none': {
      const hit = await searchStrictMatch(song).catch(() => null);
      if (!hit?.lrc) return '';
      return isInlineLyrics(hit.sourceType, hit.lrc)
        ? hit.lrc
        : musicApi.getLyrics(hit.lrc).catch(() => '');
    }
  }
}
