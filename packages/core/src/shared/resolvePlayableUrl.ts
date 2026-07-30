import type { Song } from '../types/index.js';

export interface UrlResolver {
  searchSongs: (keyword: string, page: number, sourceType: any) => Promise<Song[]>;
  getSodaAudioUrl: (trackId: string) => Promise<string>;
  getAudioUrl: (url: string) => Promise<string>;
}

/**
 * 解析歌曲的可播放 URL。
 * 策略：
 * 1. 有 url 且以 http 开头 → 直接用
 * 2. 无 url 或无效 → 搜索获取
 * 3. soda 源 → getSodaAudioUrl
 * 4. 其他 → getAudioUrl
 */
export async function resolvePlayableUrl(song: Song, resolver: UrlResolver): Promise<string> {
  let url = song.url;

  // 有合法 URL 直接返回
  if (url?.startsWith('http://') || url?.startsWith('https://')) {
    return url;
  }

  // 无 URL 或无效 → 搜索
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    if (song.name) {
      const results = await resolver.searchSongs(`${song.name} ${song.artist}`, 1, song.sourceType);
      if (results.length > 0) url = results[0].url || url;
    }
  }

  // 仍无效 → 源特定解析
  if (!url?.startsWith('http://') && !url?.startsWith('https://')) {
    if (song.sourceType === 'soda' && song.id) {
      const sodaUrl = await resolver.getSodaAudioUrl(song.id);
      if (sodaUrl?.startsWith('http://') || sodaUrl?.startsWith('https://')) {
        url = sodaUrl;
      }
    }
    if (!url?.startsWith('http://') && !url?.startsWith('https://')) {
      const resolved = await resolver.getAudioUrl(url || '');
      url = resolved || url;
    }
  }

  if (!url?.startsWith('http')) throw new Error('no playable URL');
  return url;
}