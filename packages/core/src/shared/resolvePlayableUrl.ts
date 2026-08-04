import type { Song } from '../types/index.js';
import { findExactMatch } from '../utils/songMatcher.js';

// 换源后的歌 id 带源前缀（kuwo:1303464858；旧数据可能多层嵌套 kuwo:kugou:123）：
// 按 ID 识别前循环剥离，得到源站真实 ID（链接会过期，ID 不会）
const SOURCE_ID_PREFIX = /^(netease|qq|kugou|kuwo|qianqian|soda|local):/;
export function stripSourceIdPrefix(id: string): string {
  let out = id;
  while (SOURCE_ID_PREFIX.test(out)) out = out.replace(SOURCE_ID_PREFIX, '');
  return out;
}

export interface UrlResolver {
  searchSongs: (keyword: string, page: number, sourceType: any) => Promise<Song[]>;
  /** 按源站 ID 直接识别（可选）：链接过期但 ID 有效，优先于名字搜索；force 绕过搜索缓存 */
  searchSongById?: (songId: string, sourceType: any, force?: boolean) => Promise<Song | null>;
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

  // 无 URL 或无效 → 先按源站 ID 识别（不过期，无匹配问题），失败再名字搜索
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    const baseId = song.id ? stripSourceIdPrefix(song.id) : '';
    if (baseId && resolver.searchSongById) {
      const byId = await resolver.searchSongById(baseId, song.sourceType);
      if (byId?.url?.startsWith('http')) url = byId.url;
    }
    if (!url?.startsWith('http') && song.name) {
      const results = await resolver.searchSongs(`${song.name} ${song.artist}`, 1, song.sourceType);
      const match = findExactMatch({ name: song.name, artist: song.artist }, results);
      if (match) url = (match as Song).url || url;
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

/** 解析结果：音频 URL + 歌词 URL（可为空串） */
export interface PlayableSong {
  url: string;
  lrc: string;
}

/**
 * 合并解析歌曲的音频地址和歌词地址。
 * 摄取端点（搜索）一次返回 url + lrc，各源通用；
 * 今日推荐/歌单/歌手页的歌 lrc 为空，播放时用搜索兜底一并补全。
 * 策略：
 * 1. 本地下载文件 → 直用，不搜索不补歌词
 * 2. soda → 直链（无歌词能力）
 * 3. 已有完整信息（有 url 且有 lrc）→ 零网络直接用
 * 4. lrc 或 url 缺失 → 搜索一次拿两者（有缓存）
 * 5. 搜索失败 → 退回 resolvePlayableUrl 原有路径
 */
export async function resolvePlayableSong(song: Song, resolver: UrlResolver): Promise<PlayableSong> {
  // 本地下载文件：直用，不搜索不补歌词
  if (song.url?.startsWith('file://')) {
    return { url: song.url, lrc: song.lrc || '' };
  }

  if (song.sourceType === 'soda' && song.id) {
    const u = await resolver.getSodaAudioUrl(song.id);
    if (u?.startsWith('http')) return { url: u, lrc: '' };
  }

  const hasUrl = song.url?.startsWith('http') === true;
  if (hasUrl && song.lrc) {
    return { url: song.url, lrc: song.lrc };
  }

  // 缺 url 或缺 lrc → 先按源站 ID（不过期，一次拿 url+lrc+cover），失败再名字搜索
  if (song.name || song.id) {
    const baseId = song.id ? stripSourceIdPrefix(song.id) : '';
    if (baseId && resolver.searchSongById) {
      const byId = await resolver.searchSongById(baseId, song.sourceType);
      if (byId?.url?.startsWith('http')) {
        // byId 的 url 是最新签名（原 url 可能已过期），lrc 一并补全
        return { url: byId.url, lrc: byId.lrc || song.lrc || '' };
      }
    }
    if (song.name) {
      const results = await resolver.searchSongs(`${song.name} ${song.artist}`, 1, song.sourceType);
      const fresh = findExactMatch({ name: song.name, artist: song.artist }, results) as Song | undefined;
      if (fresh) {
        const freshUrl = fresh.url?.startsWith('http') ? fresh.url : '';
        // lrc 允许相对路径（getLyrics 会 normalize 成完整 URL）
        const freshLrc = fresh.lrc || '';
        return {
          // 搜索拿到新 url 优先于可能已过期的原 url
          url: freshUrl || (hasUrl ? song.url : ''),
          lrc: freshLrc || song.lrc || '',
        };
      }
    }
  }

  // 搜索失败：退回原有解析路径（有 url 直用等）
  const url = await resolvePlayableUrl(song, resolver);
  return { url, lrc: song.lrc || '' };
}