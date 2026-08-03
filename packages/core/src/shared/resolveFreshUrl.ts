import type { Song } from '../types/index.js';
import type { UrlResolver } from './resolvePlayableUrl.js';
import { findBestMatch } from '../utils/songMatcher.js';

export interface FreshUrlResolver extends UrlResolver {
  /** fresh 解析前清掉内存中的 URL 缓存（可选） */
  clearAudioUrlCache?: () => void;
}

/**
 * 为播放失败的歌曲解析全新可播 URL（fresh 重试语义）。
 * 收藏/历史里的 url 可能已过期（音乐源直链一般数小时失效）：
 * 1. 汽水音乐 → 重新拿直链
 * 2. 普通源 → 跟随重定向取最新直链（结果未变说明源 URL 已失效）
 * 3. 最后手段 → 重新搜索拿新 URL
 * 全部失败抛错，由调用方决定跳歌/暂停。
 */
export async function resolveFreshUrl(song: Song, resolver: FreshUrlResolver): Promise<string> {
  resolver.clearAudioUrlCache?.();

  if (song.sourceType === 'soda' && song.id) {
    const u = await resolver.getSodaAudioUrl(song.id);
    if (u?.startsWith('http')) return u;
  }

  if (song.url?.startsWith('http')) {
    const u = await resolver.getAudioUrl(song.url);
    if (u?.startsWith('http') && u !== song.url) return u;
  }

  if (song.name) {
    const results = await resolver.searchSongs(`${song.name} ${song.artist}`, 1, song.sourceType);
    // 严格匹配 name+artist：搜索第一首可能是翻唱（无版权歌常见），不能直接采用
    const match = findBestMatch({ name: song.name, artist: song.artist }, results);
    const fresh = match?.song as Song | undefined;
    if (fresh?.url?.startsWith('http')) return fresh.url;
  }

  throw new Error('fresh URL resolve failed (未找到匹配版本，可能无版权)');
}
