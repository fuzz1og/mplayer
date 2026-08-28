import axios from 'axios';
import type { Song, SourceKey, SongGroup, DiscoverPlaylist, Album, AudioTag } from '../types/index.js';
import { cacheManager } from './memoryCacheManager.js';
import { beforeRequest, getAntiScrapeHeaders } from './antiScrape.js';
import { weapiRequest } from './neteaseWeapi.js';
import { BROWSER_UA, refererForUrl } from '../utils/sourceReferer.js';
import { decodeBase64Utf8 } from '../utils/base64.js';
import { looksLikeLyrics } from '../download/lyrics.js';
import { request, bodyToText } from './transport.js';
import { groupIntoSongGroups as groupIntoSongGroupsUtil } from '../utils/groupIntoSongGroups.js';
import { probeSongs } from './probeSongs.js';
import { rememberProbeResult } from './prefetchCache.js';
import {
  searchSongsRouted as routedSearchSongs,
  resolvePlayableUrlRouted as routedResolveUrl,
  resolvePlayableSongRouted as routedResolveSong,
  resolvePlayableSongDirect as routedResolveSongDirect,
} from '../shared/sourceRouter.js';
import { decodeKuwoLyricBody } from './kuwoDirect.js';
import { resolveKugouLyricUrl } from './kugouDirect.js';
import { fetchLyricViaGateway } from './qqDirect.js';
let PROXY_URL = '';

const ALBUMS_CACHE_TTL = 60 * 60 * 1000;
const RECOMMENDED_CACHE_TTL = 15 * 60 * 1000;
const SODA_URL_CACHE_TTL = 10 * 60 * 1000;
const sodaAudioUrlCache = new Map<string, { url: string; expires: number }>();

/** 会话保护端点返回的错误页特征串（无会话时 api.php 一律返回此页） */
const INVALID_REQUEST_MARKER = '非法请求';

// ── api.php 302 解析并发控制 ─────────────────────────────────────
// （apiClient/会话/拦截器/限流观察器已随 #276 归零删除；歌词门面保留
// 「非法请求」特征串检测，按失败上抛让上层换新签名 URL 重试）

export function setProxyUrl(url: string): void {
  // 代理注入接口（地图雾区「代理注入删除后的替代确认」悬而未决）：仅记录值。
  // 实际代理生效在传输层（桌面 setTransportProxyAgents）与渲染层
  // （applyElectronProxy）；RN 端 axios 不读 proxy 配置，此处历来是空操作。
  PROXY_URL = url;
}
export function getProxyUrl(): string { return PROXY_URL; }

// 歌手头像缓存，供分类 tab 爬取时补图
const artistPicCache = new Map<string, string>();

// 网易云歌手分类 cat id → weapi artist/list 的 type/area 参数
// type: 1 男, 2 女, 3 乐队;area: 7 华语, 96 欧美, 8 日本(仅列出本项目用到的分类)
const NETEASE_CAT_MAP: Record<number, { type: number; area: number }> = {
  1001: { type: 1, area: 7 },  // 华语男
  1002: { type: 2, area: 7 },  // 华语女
  1003: { type: 3, area: 7 },  // 华语组合
  2001: { type: 1, area: 96 }, // 欧美男
  2002: { type: 2, area: 96 }, // 欧美女
  2003: { type: 3, area: 96 }, // 欧美组合
  6001: { type: 1, area: 8 },  // 日本
};

function createNeteaseClient() {
  return axios.create({
    headers: {
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://music.163.com/',
    },
    timeout: 30000,
    proxy: false,
  });
}

/** 兜底:旧接口(无加密)获取网易云歌单,返回 playlist 对象或 null */
async function fetchNeteasePlaylistLegacy(playlistId: number): Promise<any | null> {
  const neteaseClient = createNeteaseClient();
  const response = await neteaseClient.get(`https://music.163.com/api/playlist/detail?id=${playlistId}`);
  const p = response.data.result || response.data.playlist;
  return p || null;
}

/**
 * 网易云歌曲字段统一映射(兼容两套字段形状)
 * - weapi: ar / al / dt(毫秒)
 * - 旧接口: artists / album / duration(毫秒)
 */
function processNeteaseTrack(song: any): Song {
  const artists = song.ar || song.artists || [];
  const album = song.al || song.album || {};
  return {
    id: String(song.id),
    name: song.name || '',
    artist: artists.map((a: any) => a.name || '').filter(Boolean).join(' / '),
    album: album.name || '',
    url: '',
    cover: (album.picUrl || '').replace(/^http:/, 'https:'),
    lrc: '',
    duration: song.dt ? Math.floor(song.dt / 1000) : Math.floor((song.duration || 0) / 1000) || 0,
    sourceType: 'netease' as const,
  };
}

function normalizeNeteaseAlbum(raw: any): Album {
  // weapi 返回 artist 单对象,旧接口返回 artists 数组;兼容两种形状
  const rawArtist = raw.artists || raw.artist || [];
  const artistList = Array.isArray(rawArtist) ? rawArtist : [rawArtist];
  const artist = artistList.map((a: any) => a?.name || '').filter(Boolean).join(' / ') || '';

  return {
    id: String(raw.id),
    name: raw.name || raw.album?.name || '',
    picUrl: raw.picUrl || raw.album?.picUrl || raw.coverImgUrl || '',
    artist,
    publishTime: raw.publishTime || raw.publish_time || '',
  };
}
/**
 * 歌词响应体归一化（T06 #152）：QQ fcg 歌词端点返回 JSON，`lyric` 字段为
 * base64 编码的 LRC 文本 → 解码为 LRC；非 JSON / 无 lyric 字段原样返回。
 * 纯函数，独立导出供测试。
 */
export function decodeLyricBody(body: unknown): string {
  if (typeof body !== 'string') return '';
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return body;
  try {
    const parsed = JSON.parse(trimmed) as { lyric?: unknown };
    if (typeof parsed.lyric === 'string' && parsed.lyric.length > 0) {
      const decoded = decodeBase64(parsed.lyric);
      if (decoded) return decoded;
    }
  } catch {
    // 非 JSON：按原样返回
  }
  return body;
}

function decodeBase64(input: string): string {
  return decodeBase64Utf8(input);
}

/**
 * 补全 URL，确保返回完整的绝对 URL
 * （自建 API 已退役：API_BASE_URL 恒空，歌词 URL 均为源站绝对地址，
 * 仅保留绝对/协议相对 URL 归一化）
 * @param url 可能是相对路径或绝对 URL
 * @returns 完整的绝对 URL
 */
function normalizeUrl(url: string | undefined): string {
  if (!url) return '';

  // 如果已经是完整的 URL（以 http:// 或 https:// 开头），直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // 如果是以 // 开头的协议相对 URL，添加 https:
  if (url.startsWith('//')) {
    return 'https:' + url;
  }

  return url;
}

// 热榜歌曲类型
interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

/**
 * QQ v8 榜单单曲 → HotlistSong（#172）。
 * id **优先取 songmid**：GetVkey 直连腿按 songmid 键控，数字 id 走直连恒为空
 * （与无版权/VIP 无关），整榜 100% 依赖 tier3、探测预取全部无效。
 * 数字 id 仅在响应缺失 mid 时兜底。封面用 album.mid 构建（同接口约定）。
 */
export function mapQQToplistItem(item: any, index: number): HotlistSong | null {
  const songData = item?.data;
  if (!songData) return null;
  const artists = songData.singer?.map((singer: any) => singer.name).join('/') || '';
  const albumMid = songData.album?.mid || '';
  return {
    id: songData.mid || songData.id?.toString() || '',
    name: songData.name || '',
    artists,
    rank: index + 1,
    cover: albumMid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}_1.jpg`
      : '',
    album: songData.album?.name || ''
  };
}

/** 汽水分享页结构化歌词单字（sentences[].words[] 项，行内逐字时间轴）。 */
export interface SodaLyricWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** 汽水分享页结构化歌词行（sentences[] 项，type=krc/lrc）。 */
export interface SodaLyricSentence {
  startMs: number;
  endMs: number;
  text: string;
  /** 逐字时间轴；缺省/为空时行文本取整句 text。 */
  words?: SodaLyricWord[];
  type?: string;
}

/**
 * 汽水分享页结构化歌词（sentences[]）→ LRC 文本（纯函数，可单测）。
 * 输入为分享页 _ROUTER_DATA.audioWithLyricsOption.lyrics.sentences。
 * 行文本取 words[].text 拼接（回退整句 text）；时间轴 [mm:ss.xxx]。
 */
export function sodaSentencesToLrc(sentences: SodaLyricSentence[] | null | undefined): string {
  if (!Array.isArray(sentences) || sentences.length === 0) return '';
  const lines: string[] = [];
  for (const s of sentences) {
    if (typeof s?.startMs !== 'number') continue;
    const text =
      Array.isArray(s.words) && s.words.length > 0
        ? s.words.map((w) => w?.text ?? '').join('')
        : s.text ?? '';
    if (!text.trim()) continue;
    const ms = s.startMs;
    const mm = Math.floor(ms / 60000);
    const ss = Math.floor((ms % 60000) / 1000);
    const xxx = ms % 1000;
    lines.push(`[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xxx).padStart(3, '0')}]${text}`);
  }
  return lines.join('\n');
}

export const musicApi = {
  /**
   * 构建汽水音乐封面 URL
   */
  sodaBuildImageUrl(urlCover: { urls?: string[]; uri?: string } | undefined): string {
    if (!urlCover || !urlCover.urls || urlCover.urls.length === 0) return '';
    let cover = (urlCover.urls[0] || '').trim();
    const uri = (urlCover.uri || '').trim();
    if (uri && !cover.includes(uri)) cover += uri;
    if (cover && !cover.includes('~')) cover += '~c5_375x375.jpg';
    return cover;
  },

  /**
   * 搜索汽水音乐 (直接调用 api.qishui.com)
   * 注：搜索结果不含 audio_url，播放/探测时会通过 trackId 单独解析直链
   */
  async searchSongsSoda(keyword: string, page: number = 1): Promise<Song[]> {
    const cacheKey = `soda_search_${keyword}_${page}`;
    const cached = cacheManager.getSearchCache(cacheKey, page, 'soda');
    if (cached) return cached;

    const params = new URLSearchParams();
    params.set('q', keyword);
    params.set('cursor', String((page - 1) * 20));
    params.set('search_method', 'input');
    params.set('aid', '386088');
    params.set('device_platform', 'web');
    params.set('channel', 'pc_web');

    // 路径要点：luna/search/track（无 pc 段）。旧 luna/pc/search/track 返回 200 空 body（接口已改版），
    // 无 pc 段的路径免登录可用（2026-08 实测：大陆 IP 直连返回完整 result_groups）。
    const apiURL = 'https://api.qishui.com/luna/search/track?' + params.toString();
    const res = await request({
      method: 'GET',
      url: apiURL,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      },
      timeoutMs: 15000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`汽水搜索 HTTP ${res.status}`);
    }
    const data = JSON.parse(bodyToText(res.body)) as {
      result_groups?: { data?: { entity?: { track?: any } }[] }[];
    };
    const songs: Song[] = [];

    if (data.result_groups && data.result_groups.length > 0) {
      for (const item of data.result_groups[0].data || []) {
        const track = item.entity?.track;
        if (!track || !track.id) continue;

        const artist = (track.artists || []).map((a: { name: string }) => a.name).join(' / ');
        const cover = this.sodaBuildImageUrl(track.album?.url_cover);
        const albumName = track.album?.name || '';
        const duration = track.duration ? Math.floor(track.duration / 1000) : 0;

        songs.push({
          id: track.id,
          name: track.name || '',
          artist,
          album: albumName,
          url: '',
          cover,
          lrc: '',
          duration,
          sourceType: 'soda',
        });
      }
    }

    cacheManager.setSearchCache(cacheKey, page, 'soda', songs);
    return songs;
  },


  /**
   * 解析汽水分享页（music.douyin.com/qishui/share/track，免登录）。
   *
   * _ROUTER_DATA.audioWithLyricsOption 同时含：
   * - url：音频直链（encrypt=false，未加密；付费歌为试听段）
   * - lyrics.sentences[]：结构化歌词（startMs/endMs/text/words，lyricType=krc），
   *   免登录即可拿，无需 track_v2 的登录态 Cookie
   * - trackInfo.duration：权威完整时长（ms），供探测 resolveUrlInfo 时长校验
   *
   * 返回 lyrics 为 LRC 文本（[mm:ss.xxx]行），无歌词返回空串。
   */
  async fetchSodaSharePage(trackId: string): Promise<{
    audioUrl: string;
    name: string;
    artist: string;
    cover: string;
    lyrics: string;
    durationMs: number;
  } | null> {
    const shareUrl = `https://music.douyin.com/qishui/share/track?track_id=${trackId}`;
    try {
      const response = await axios.get(shareUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
        timeout: 15000,
      });
      const html = response.data;
      const match = html.match(/_ROUTER_DATA\s*=\s*({[\s\S]*?});/);
      if (!match) return null;
      const data = JSON.parse(match[1], (_key, value) => {
        if (_key === '__proto__' || _key === 'constructor' || _key === 'prototype') {
          return undefined;
        }
        return value;
      });
      const audio = data?.loaderData?.track_page?.audioWithLyricsOption;
      if (!audio?.url) return null;

      // 结构化歌词 → LRC 文本（sodaSentencesToLrc 纯函数，可单测）
      const sentences = audio?.lyrics?.sentences;
      const lyrics = sodaSentencesToLrc(sentences);

      return {
        audioUrl: decodeURIComponent(audio.url),
        name: audio.trackName || '',
        artist: audio.artistName || '',
        cover: audio.coverURL || '',
        lyrics,
        // trackInfo.duration 为权威完整时长（ms），供探测 resolveUrlInfo 时长校验
        // （playTime）；audio.duration 为浮点秒，两者一致
        durationMs: typeof audio?.trackInfo?.duration === 'number' ? audio.trackInfo.duration : 0,
      };
    } catch {
      return null;
    }
  },

  /**
   * 获取汽水音乐音频直链（用于下载）
   * 优先用分享页 _ROUTER_DATA（无需Cookie），fallback 到 track_v2
   */
  async getSodaAudioUrl(trackId: string): Promise<string> {
    const cached = sodaAudioUrlCache.get(trackId);
    if (cached && cached.expires > Date.now()) return cached.url;

    const page = await this.fetchSodaSharePage(trackId);
    if (page?.audioUrl) {
      this.cacheSodaAudioUrl(trackId, page.audioUrl);
      return page.audioUrl;
    }

    // 注意：track_v2 匿名请求 2026-08 实测返回 200 空 body（需 PC 客户端登录态
    // Cookie，见 CONTEXT.md「汽水歌词」），下述 fallback 基本必空，保留仅为历史
    // 兼容（若未来接入登录态凭证可复用此段）；分享页失败时返回 '' 由调用方兜底。
    const params = new URLSearchParams();
    params.set('track_id', trackId);
    params.set('media_type', 'track');
    params.set('aid', '386088');
    params.set('device_platform', 'web');
    params.set('channel', 'pc_web');

    const apiURL = 'https://api.qishui.com/luna/pc/track_v2?' + params.toString();
    try {
      const response = await axios.get(apiURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
        timeout: 15000,
      });

      const data = response.data;
      const track = data.track || data.track_info;
      if (!track) return '';

      const playInfoList = track.audio_info?.play_info_list || [];
      if (playInfoList.length === 0) return '';

      const best = playInfoList.reduce((a: any, b: any) =>
        (a.size || 0) > (b.size || 0) ? a : b
      );
      const audioUrl = best.main_play_url || best.backup_play_url || '';
      if (!audioUrl) return '';

      const auth = best.play_auth || '';
      const result = auth ? `${audioUrl}?play_auth=${encodeURIComponent(auth)}` : audioUrl;
      this.cacheSodaAudioUrl(trackId, result);
      return result;
    } catch (error) {
      console.error('获取汽水音乐音频 URL 失败:', error);
      return '';
    }
  },

  /**
   * 获取汽水音乐歌词（分享页免登录结构化歌词 → LRC 文本）。
   * 分享页 audioWithLyricsOption.lyrics.sentences 已是结构化时间轴，
   * 无需 track_v2 的登录态 Cookie；无歌词返回空串。
   */
  async getSodaLyrics(trackId: string): Promise<string> {
    if (!trackId) return '';
    const cacheKey = `soda_lyric_${trackId}`;
    const cached = cacheManager.getLyricsCache(cacheKey);
    if (cached !== null) return cached;
    try {
      const page = await this.fetchSodaSharePage(trackId);
      const lyrics = page?.lyrics || '';
      if (lyrics) cacheManager.setLyricsCache(cacheKey, lyrics);
      return lyrics;
    } catch {
      return '';
    }
  },

  cacheSodaAudioUrl(trackId: string, url: string): void {
    // 顺带清理过期项，防 Map 无界增长（每首歌一个 entry，长期会话会积累）
    if (sodaAudioUrlCache.size >= 500) {
      const now = Date.now();
      for (const [k, v] of sodaAudioUrlCache) {
        if (v.expires < now) sodaAudioUrlCache.delete(k);
      }
    }
    sodaAudioUrlCache.set(trackId, { url, expires: Date.now() + SODA_URL_CACHE_TTL });
  },

  /**
   * 解析汽水音乐分享链接，返回歌曲信息
   * 原理：抓分享页 HTML，提取 _ROUTER_DATA JSON，获取歌曲信息 + 音频直链
   * 支持格式：https://qishui.douyin.com/s/xxx 和 https://music.douyin.com/qishui/share/track?track_id=xxx
   */
  async parseSodaShareLink(link: string): Promise<Song | null> {
    try {
      // SSRF 防护：仅允许汽水音乐/抖音域名
      const allowedHosts = ['qishui.douyin.com', 'music.douyin.com'];
      const url = new URL(link);
      if (!allowedHosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
        throw new Error('不支持的链接域名');
      }

      const response = await axios.get(link, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
        maxRedirects: 10,
        timeout: 15000,
      });

      const html = response.data;
      const match = html.match(/_ROUTER_DATA\s*=\s*({[\s\S]*?});/);
      if (!match) return null;

      const data = JSON.parse(match[1], (_key, value) => {
        if (_key === '__proto__' || _key === 'constructor' || _key === 'prototype') {
          return undefined;
        }
        return value;
      });
      const audio = data?.loaderData?.track_page?.audioWithLyricsOption;
      if (!audio || !audio.trackName) return null;

      const trackInfo = audio.trackInfo || {};
      const album = trackInfo.album || {};
      const cover = audio.coverURL || '';
      const audioUrl = audio.url ? decodeURIComponent(audio.url) : '';
      const artistName = audio.artistName || '';
      const albumName = album.name || '';
      const trackId = data?.loaderData?.track_page?.track_id || trackInfo.id || '';

      return {
        id: String(trackId),
        name: audio.trackName || '',
        artist: artistName,
        album: albumName,
        url: audioUrl,
        cover,
        lrc: '',
        duration: trackInfo.duration ? Math.floor(trackInfo.duration / 1000) : 0,
        sourceType: 'soda',
      };
    } catch (error) {
      console.error('解析汽水音乐分享链接失败:', error);
      return null;
    }
  },

  async getLyrics(lrcUrl: string): Promise<string> {
    const fullUrl = normalizeUrl(lrcUrl);
    if (!fullUrl) return '';

    // 尝试从缓存获取
    const cachedData = cacheManager.getLyricsCache(fullUrl);
    if (cachedData) {
      return cachedData;
    }

    // 第三方歌词 URL（QQ fcg / 酷我 newlyric / 酷狗两步）需要浏览器 UA + 官方 Referer，
    // 否则 CDN 防盗链会因 axios 默认 UA / 缺 Referer 返回 403 或空响应。
    const referer = refererForUrl(fullUrl);
    const isKuwoLyric = fullUrl.includes('newlyric.kuwo.cn');
    const isKugouLyric = fullUrl.includes('lyrics.kugou.com/search');
    const isQQFcgLyric = /c\.y\.qq\.com\/lyric\//i.test(fullUrl);
    const lyricHeaders: Record<string, string> = {};
    if (referer) lyricHeaders['Referer'] = referer;
    if (isKuwoLyric || isKugouLyric || isQQFcgLyric) {
      lyricHeaders['User-Agent'] = BROWSER_UA;
    }
    let lyrics: string;
    if (isKugouLyric) {
      // 酷狗歌词是两步接口：search → download。这里不要再先 GET 一次 search URL，
      // 直接交给 resolveKugouLyricUrl 走完整链路，避免多余请求导致 403/失败。
      lyrics = await resolveKugouLyricUrl(fullUrl);
    } else {
      try {
        // 统一传输层（直连客户端/探测同缝，重试/超时/降级一致）；
        // transport 对 4xx/5xx 不抛错（返回 status），此处显式转抛以保持
        // 「非 QQ 源失败上抛 / QQ 源落网关兜底」的既有语义。
        const res = await request({
          method: 'GET',
          url: fullUrl,
          headers: lyricHeaders,
          responseType: isKuwoLyric ? 'arraybuffer' : 'text',
          timeoutMs: 12000,
        });
        if (res.status >= 400) {
          throw new Error(`歌词请求 HTTP ${res.status}`);
        }
        // 酷我：tp=content + zlib + XOR + gb18030 管线；其余走 JSON/base64 或原样
        lyrics = isKuwoLyric
          ? decodeKuwoLyricBody(
              typeof res.body === 'string'
                ? new TextEncoder().encode(res.body)
                : new Uint8Array(res.body),
            )
          : decodeLyricBody(bodyToText(res.body));
      } catch (e) {
        if (!isQQFcgLyric) throw e;
        lyrics = ''; // QQ：GET 失败（网络/超时/4xx/5xx）同样落网关兜底
      }
      // QQ fcg GET 强制 Referer 防盗链（缺 Referer 返回 retcode=-1310 拒绝体，
      // 解不出 LRC）；桌面 Chromium/Node 栈带得上 Referer，RN 网络栈真机被拒。
      // 被拒时改走 musicu 网关取词（与搜索/GetVkey 同通道，无 Referer 校验）。
      if (isQQFcgLyric && !looksLikeLyrics(lyrics)) {
        const songmid = /[?&]songmid=([^&]+)/.exec(fullUrl)?.[1] || '';
        console.info(`[lyrics] QQ fcg GET 未拿到歌词，musicu 网关兜底 songmid=${songmid}`);
        const viaGateway = songmid ? await fetchLyricViaGateway(songmid).catch(() => '') : '';
        if (looksLikeLyrics(viaGateway)) lyrics = viaGateway;
      }
    }

    // 会话失效/签名过期：服务端返回「非法请求」页（200 text/html）。
    // 按失败抛出让上层走搜索换新签名 URL 重试，否则 parseLRC 拿到空行会
    // 静默显示"无歌词"，歌词永远刷新不出来（移动端实测现象）。
    if (typeof lyrics === 'string' && lyrics.includes(INVALID_REQUEST_MARKER)) {
      throw new Error('歌词会话失效（非法请求），需重新搜索歌词 URL');
    }

    // 只缓存真正的 LRC；错误页/JSON 错误体/无时间戳内容不缓存、按无歌词返回，
    // 避免之前失败的坏结果把同一 lrc URL 卡在内存缓存里，导致修复后仍显示暂无歌词。
    if (!looksLikeLyrics(lyrics)) {
      return '';
    }

    // 缓存结果
    cacheManager.setLyricsCache(fullUrl, lyrics);
    return lyrics;
  },

  /**
   * 按网易云 songId 获取歌词文本（LRC）。
   * 兜底场景：今日推荐/歌单/歌手页的歌曲 lrc 字段为空
   * （源接口不返回歌词链接），播放时用它补上。
   * 无歌词（纯音乐等）返回空串。
   */
  async getLyricsBySongId(songId: string): Promise<string> {
    if (!songId) return '';
    const cacheKey = `lyric_id_${songId}`;
    const cached = cacheManager.getLyricsCache(cacheKey);
    if (cached !== null) return cached;

    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(
        `https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&lv=1&kv=1&tv=-1`
      );
      const lyrics = (response.data?.lrc?.lyric as string) || '';
      // issue #246：空歌词（404/纯音乐）不入缓存——否则永久命中空串、无兜底重试机会
      if (lyrics) cacheManager.setLyricsCache(cacheKey, lyrics);
      return lyrics;
    } catch {
      return '';
    }
  },

  async searchNeteaseArtists(keyword: string, limit: number = 30): Promise<any[]> {
    const cacheKey = `search_artists_${keyword}_${limit}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && Array.isArray(cached)) {
      return cached as unknown as any[];
    }

    const mapArtists = (rawArtists: any[]) => rawArtists.map((a: any) => ({
      id: String(a.id),
      name: a.name || '',
      picUrl: (a.picUrl || a.img1v1Url || '').replace(/^http:/, 'https:'),
      alias: a.alias || [],
      trans: a.trans || undefined,
      albumSize: a.albumSize || 0,
      musicSize: a.musicSize || 0,
      sourceType: 'netease'
    }));

    // 注:cloudsearch weapi 已被网易云风控(code=50000005,无 cookie 必现),
    // 直接走旧接口(已做 https 头像修复);后续若接入 cookie 机制可恢复 weapi 优先
    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=100&limit=${limit}`);
      const data = response.data;
      const rawArtists: any[] = data?.result?.artists || [];

      const artists = mapArtists(rawArtists);

      cacheManager.setSearchCache(cacheKey, 1, 'netease', artists as any);
      return artists;
    } catch (error) {
      console.error('搜索歌手失败:', error);
      return [];
    }
  },

  async getNeteaseArtists(cat: number = 1001, offset: number = 0, limit: number = 100, initial: number = -1): Promise<{ artists: any[]; total: number; more: boolean }> {
    const mapped = NETEASE_CAT_MAP[cat];
    if (mapped || cat === 0) {
      // weapi 直连(带头像、结构化、可分页),失败时按原路径兜底
      const res = await this.fetchNeteaseArtistsByWeapi(mapped?.type ?? 0, mapped?.area ?? -1, offset, limit, initial);
      if (res.ok) return res;
      if (cat === 0) return this.fetchNeteaseArtistsByApi(offset, limit, initial);
    }
    return this.fetchNeteaseArtistsByHtml(cat);
  },

  async fetchNeteaseArtistsByWeapi(type: number, area: number, offset: number, limit: number, initial: number): Promise<{ artists: any[]; total: number; more: boolean; ok: boolean }> {
    const cacheKey = `artists_weapi_${type}_${area}_${offset}_${limit}_${initial}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).artists) {
      return cached as unknown as { artists: any[]; total: number; more: boolean; ok: boolean };
    }

    try {
      const data = await weapiRequest<any>('/v1/artist/list', { type, area, initial, offset, limit, total: true });
      if (data.code !== 200 || !data.artists) {
        throw new Error(`获取歌手列表失败 (type=${type}, area=${area})`);
      }
      const artists = data.artists.map((a: any) => ({
        id: String(a.id),
        name: a.name || '',
        picUrl: (a.picUrl || a.img1v1Url || '').replace(/^http:/, 'https:'),
        alias: a.alias || [],
        trans: a.trans || undefined,
        albumSize: a.albumSize || 0,
        musicSize: a.musicSize || 0,
        sourceType: 'netease'
      }));

      for (const a of artists) {
        if (a.picUrl && !artistPicCache.has(a.name)) {
          artistPicCache.set(a.name, a.picUrl);
        }
      }

      const result = { artists, total: artists.length, more: data.more !== false, ok: true };
      cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
      return result;
    } catch (error) {
      console.error('获取歌手列表失败(weapi):', error);
      return { artists: [], total: 0, more: false, ok: false };
    }
  },

  async fetchNeteaseArtistsByApi(offset: number, limit: number, initial: number): Promise<{ artists: any[]; total: number; more: boolean }> {
    const cacheKey = `artists_api_${offset}_${limit}_${initial}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).artists) {
      return cached as unknown as { artists: any[]; total: number; more: boolean };
    }

    try {
      const neteaseClient = createNeteaseClient();
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
        initial: String(initial),
      });
      const response = await neteaseClient.get(`https://music.163.com/api/v1/artist/list?${params.toString()}`);
      const data = response.data;
      const rawArtists: any[] = data?.artists || [];
      const more: boolean = data?.more || false;

      const artists = rawArtists.map((a: any) => ({
        id: String(a.id),
        name: a.name || '',
        picUrl: a.picUrl || a.img1v1Url || '',
        alias: a.alias || [],
        trans: a.trans || undefined,
        albumSize: a.albumSize || 0,
        musicSize: a.musicSize || 0,
        sourceType: 'netease'
      }));

      // 缓存歌手头像地址，供分类 tab 爬取时补图
      for (const a of artists) {
        if (a.picUrl && !artistPicCache.has(a.name)) {
          artistPicCache.set(a.name, a.picUrl);
        }
      }

      const result = { artists, total: artists.length, more };
      cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
      return result;
    } catch (error) {
      console.error('获取歌手列表失败:', error);
      return { artists: [], total: 0, more: false };
    }
  },

  async fetchNeteaseArtistsByHtml(catId: number): Promise<{ artists: any[]; total: number; more: boolean }> {
    const cacheKey = `artists_html_${catId}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).artists) {
      return cached as unknown as { artists: any[]; total: number; more: boolean };
    }

    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(`https://music.163.com/discover/artist/cat?id=${catId}`);
      const html = response.data;

      const artistBoxMatch = html.match(/id="m-artist-box">(.*?)<\/ul>/s);
      if (!artistBoxMatch) {
        console.error('[musicApi] fetchNeteaseArtistsByHtml 未找到歌手列表数据');
        return { artists: [], total: 0, more: false };
      }

      const box = artistBoxMatch[1];
      const itemRegex = /<li[^>]*>(.*?)<\/li>/gs;
      const artists: any[] = [];
      let itemMatch;

      while ((itemMatch = itemRegex.exec(box)) !== null) {
        const item = itemMatch[1];
        const nameMatch = item.match(/<a[^>]*href="\s*\/artist\?id=(\d+)"[^>]*class="nm[^"]*"[^>]*>([^<]+)<\/a>/);
        if (!nameMatch) continue;

        const imgMatch = item.match(/<img src="([^"]+)"/);
        const name = nameMatch[2].trim();
        const picUrl = imgMatch?.[1] || artistPicCache.get(name) || '';

        artists.push({
          id: nameMatch[1],
          name,
          picUrl,
          alias: [],
          trans: undefined,
          albumSize: 0,
          musicSize: 0,
          sourceType: 'netease'
        });
      }

      // 对 HTML 解析后仍缺图的歌手，限制并发补图 (冷门歌手兜底)
      const CONCURRENCY = 6;
      const artistsNeedingPic = artists.filter(a => !a.picUrl);
      for (let i = 0; i < artistsNeedingPic.length; i += CONCURRENCY) {
        const batch = artistsNeedingPic.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (a) => {
          try {
            const detailRes = await neteaseClient.get(`https://music.163.com/api/artist?id=${a.id}`);
            const detail = detailRes.data?.artist;
            a.picUrl = detail?.picUrl || detail?.img1v1Url || '';
            if (a.picUrl) artistPicCache.set(a.name, a.picUrl);
          } catch {}
        }));
      }

      const result = { artists, total: artists.length, more: false };
      cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
      return result;
    } catch (error) {
      console.error('获取歌手列表失败:', error);
      return { artists: [], total: 0, more: false };
    }
  },

  async getNeteaseArtistSongs(artistId: string, offset: number = 0, limit: number = 50, order: string = 'hot'): Promise<{ songs: Song[]; total: number }> {
    const cacheKey = `artist_songs_${artistId}_${offset}_${limit}_${order}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).songs) {
      return cached as unknown as { songs: Song[]; total: number };
    }

    let songs: Song[] = [];
    let total = 0;
    try {
      const data = await weapiRequest<any>('/v1/artist/songs', { id: Number(artistId), private_cloud: 'true', work_type: 1, order, offset, limit });
      if (data.code !== 200) {
        throw new Error(`获取歌手歌曲失败 (artistId=${artistId})`);
      }
      songs = (data.songs || []).map((song: any) => processNeteaseTrack(song));
      total = data.total || 0;
    } catch (error) {
      console.error(`获取歌手歌曲失败(weapi),回退旧接口 (artistId=${artistId}):`, error);
      try {
        const neteaseClient = createNeteaseClient();
        const response = await neteaseClient.get(`https://music.163.com/api/v1/artist/songs?id=${artistId}&offset=${offset}&limit=${limit}&order=${order}`);
        const data = response.data;
        songs = (data.songs || []).map((song: any) => processNeteaseTrack(song));
        total = data.total || 0;
      } catch (error2) {
        console.error('获取歌手歌曲失败(旧接口):', error2);
        return { songs: [], total: 0 };
      }
    }

    const result = { songs, total };
    cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
    return result;
  },

  /**
   * 网易云音乐排行榜通用方法
   * @param playlistId 歌单 ID(热歌榜 3778678,新歌榜 3779629)
   * @param cacheKey 缓存键
   */
  async getNeteaseToplist(playlistId: number, cacheKey: string): Promise<HotlistSong[]> {
    const cachedData = cacheManager.getHotlistCache(cacheKey);
    if (cachedData && cachedData.length > 0) {
      return cachedData;
    }

    const tracks: any[] = [];
    try {
      // weapi:一次请求即带全量 tracks
      const data = await weapiRequest<any>('/v6/playlist/detail', { id: playlistId, n: 100000, s: 8 });
      if (data.code !== 200 || !data.playlist?.tracks) {
        throw new Error(`获取网易排行榜数据失败 (playlistId=${playlistId})`);
      }
      tracks.push(...data.playlist.tracks);
    } catch (error) {
      console.error(`获取网易排行榜失败 (cacheKey=${cacheKey}),回退旧接口:`, error);
      try {
        const p = await fetchNeteasePlaylistLegacy(playlistId);
        if (p?.tracks) tracks.push(...p.tracks);
      } catch (error2) {
        console.error(`获取网易排行榜失败 (cacheKey=${cacheKey},旧接口):`, error2);
      }
    }

    const hotlistSongs: HotlistSong[] = tracks.map((song: any, index: number) => {
      const artists = (song.ar || song.artists || []).map((artist: any) => artist.name).join('/');
      const cover = (song.al?.picUrl || song.album?.picUrl || '');

      return {
        id: song.id.toString(),
        name: song.name,
        artists: artists,
        rank: index + 1,
        cover: cover,
        album: song.al?.name || song.album?.name || ''
      };
    });

    if (hotlistSongs.length > 0) {
      cacheManager.setHotlistCache(cacheKey, hotlistSongs);
    }
    return hotlistSongs;
  },

  async getNeteaseHotlist(): Promise<HotlistSong[]> {
    return this.getNeteaseToplist(3778678, 'netease');
  },

  async getNeteaseNewSongList(): Promise<HotlistSong[]> {
    return this.getNeteaseToplist(3779629, 'netease_new');
  },

  /**
   * QQ 音乐排行榜通用方法
   * @param topid 榜单 ID（热歌榜 26，新歌榜 27）
   * @param cacheKey 缓存键
   */
  async getQQToplist(topid: number, cacheKey: string): Promise<HotlistSong[]> {
    const cachedData = cacheManager.getHotlistCache(cacheKey);
    if (cachedData && cachedData.length > 0) {
      return cachedData;
    }

    try {
      // 获取当前日期，格式为 YYYY-MM-DD
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      // 使用旧 API 端点获取 albummid，用于构建封面 URL
      const url = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?newsong=1&tpl=3&page=detail&date=${dateStr}&topid=${topid}&type=top&song_begin=0&song_num=100&g_tk=5381&format=json&inCharset=utf-8&outCharset=utf-8&notice=0`;

      await beforeRequest();
      const qqClient = axios.create({
        headers: {
          ...getAntiScrapeHeaders('https://y.qq.com/'),
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://y.qq.com/',
        },
        timeout: 30000,
    proxy: false,
        responseType: 'text'
      });

      let response = await qqClient.get(url);
      let data = response.data;

      // 确保数据是字符串类型
      let dataStr = typeof data === 'string' ? data : JSON.stringify(data);

      // 解析JSON格式的数据
      let jsonData = JSON.parse(dataStr);

      // 如果今天的数据还没有更新（code不为0），尝试使用昨天的日期
      if (jsonData.code !== 0) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const yesterdayUrl = url.replace(dateStr, yesterdayStr);
        response = await qqClient.get(yesterdayUrl);
        data = response.data;
        dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        jsonData = JSON.parse(dataStr);
      }

      // 检查songlist字段
      const songlist = jsonData.songlist || [];

      if (!Array.isArray(songlist)) {
        throw new Error(`无法解析QQ音乐排行榜数据 (topid=${topid})，songlist不是数组`);
      }

      // 转换为热榜歌曲格式
      const hotlistSongs: HotlistSong[] = [];

      for (let index = 0; index < songlist.length; index++) {
        // 映射失败的单曲跳过（与原内联 try/catch 语义一致）
        const mapped = mapQQToplistItem(songlist[index], index);
        if (mapped) hotlistSongs.push(mapped);
      }

      // 缓存结果
      cacheManager.setHotlistCache(cacheKey, hotlistSongs);
      return hotlistSongs;
    } catch (error) {
      console.error(`获取QQ音乐排行榜失败 (cacheKey=${cacheKey}):`, error);
      return [];
    }
  },

  async getQQHotlist(): Promise<HotlistSong[]> {
    return this.getQQToplist(26, 'qq');
  },

  async getQQNewSongList(): Promise<HotlistSong[]> {
    return this.getQQToplist(27, 'qq_new');
  },

  async getNeteasePlaylists(
    cat: string = '全部',
    order: string = 'hot',
    offset: number = 0,
    limit: number = 35
  ): Promise<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }> {
    const cacheKey = `playlistList_${cat}_${order}_${offset}_${limit}`;
    const cached = cacheManager.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const neteaseClient = axios.create({
        headers: {
          'accept': 'application/json, text/javascript, */*; q=0.01',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://music.163.com/'
        },
        timeout: 30000,
    proxy: false,
      });

      const response = await neteaseClient.get(
        `https://music.163.com/api/playlist/list?cat=${encodeURIComponent(cat)}&order=${order}&offset=${offset}&limit=${limit}`
      );

      const data = response.data;
      const playlists: DiscoverPlaylist[] = (data.playlists || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        coverImgUrl: p.coverImgUrl || '',
        playCount: p.playCount || 0,
        trackCount: p.trackCount || 0,
        creator: { nickname: p.creator?.nickname || '' },
        tags: (p.tags || []).map((t: any) => typeof t === "string" ? t : t.name || ""),
        description: p.description || ''
      }));

      const result = {
        playlists,
        total: data.total || 0,
        more: data.more || false
      };

      cacheManager.set(cacheKey, result, 5 * 60 * 1000);
      return result;
    } catch (error) {
      console.error('[MusicApi] getNeteasePlaylists 失败:', error);
      return { playlists: [], total: 0, more: false };
    }
  },

  async getNeteasePlaylistDetail(id: number): Promise<DiscoverPlaylist | null> {
    const cacheKey = `playlistDetail_${id}`;
    const cached = cacheManager.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    let playlistData: any = null;
    try {
      const data = await weapiRequest<any>('/v6/playlist/detail', { id, n: 100000, s: 8 });
      if (data.code !== 200 || !data.playlist) {
        throw new Error(`获取网易云歌单详情失败 (id=${id})`);
      }
      playlistData = data.playlist;
    } catch (error) {
      console.error(`[MusicApi] getNeteasePlaylistDetail weapi 失败,回退旧接口:`, error);
      try {
        playlistData = await fetchNeteasePlaylistLegacy(id);
      } catch (error2) {
        console.error('[MusicApi] getNeteasePlaylistDetail 失败(旧接口):', error2);
      }
    }

    if (!playlistData) return null;

    const playlist: DiscoverPlaylist = {
      id: playlistData.id,
      name: playlistData.name,
      coverImgUrl: playlistData.coverImgUrl || '',
      playCount: playlistData.playCount || 0,
      trackCount: playlistData.trackCount || 0,
      creator: { nickname: playlistData.creator?.nickname || '' },
      tags: (playlistData.tags || []).map((t: any) => typeof t === "string" ? t : t.name || ""),
      description: playlistData.description || ''
    };

    cacheManager.set(cacheKey, playlist, 5 * 60 * 1000);
    return playlist;
  },

  /**
   * 获取网易云歌单全量 trackIds(weapi 直连,精确 id,10 分钟缓存)
   * 分页与全量获取共用,避免重复请求歌单元信息
   */
  async getNeteasePlaylistTrackIds(playlistId: number): Promise<number[]> {
    const cacheKey = `netease_playlist_trackids_${playlistId}`;
    const cached = cacheManager.get<number[]>(cacheKey);
    if (cached) return cached;

    let trackIds: number[] = [];
    try {
      const detail = await weapiRequest<{ code: number; playlist?: any }>('/v6/playlist/detail', { id: playlistId, n: 100000, s: 8 });
      if (detail.code !== 200 || !detail.playlist) {
        throw new Error(`获取网易云歌单失败 (id=${playlistId})`);
      }
      trackIds = (detail.playlist.trackIds || []).map((t: any) => t.id);
    } catch (error) {
      console.error(`[MusicApi] getNeteasePlaylistTrackIds weapi 失败,回退旧接口 (id=${playlistId}):`, error);
      try {
        const p = await fetchNeteasePlaylistLegacy(playlistId);
        trackIds = (p?.tracks || []).map((t: any) => t.id);
      } catch (error2) {
        console.error(`[MusicApi] getNeteasePlaylistTrackIds 失败(旧接口) (id=${playlistId}):`, error2);
      }
    }

    if (trackIds.length > 0) cacheManager.set(cacheKey, trackIds, 10 * 60 * 1000);
    return trackIds;
  },

  /**
   * weapi 批量取歌曲播放地址(id → url),免费歌曲全覆盖,VIP 歌返回空
   */
  async fetchNeteaseSongUrlMap(ids: number[]): Promise<Map<number, string>> {
    const urlMap = new Map<number, string>();
    if (ids.length === 0) return urlMap;
    try {
      const urlData = await weapiRequest<{ code: number; data?: { id: number; url?: string }[] }>(
        '/song/enhance/player/url/v1',
        { ids: '[' + ids.join(',') + ']', level: 'standard', encodeType: 'mp3' }
      );
      if (urlData.code === 200 && Array.isArray(urlData.data)) {
        for (const d of urlData.data) {
          if (d.url) urlMap.set(d.id, d.url.replace(/^http:/, 'https:'));
        }
      }
    } catch (error) {
      console.error('[MusicApi] fetchNeteaseSongUrlMap 失败:', error);
    }
    return urlMap;
  },

  /**
   * 批量补齐歌曲可播放 URL：weapi by-ID 批量直连（免费歌曲全覆盖，VIP 返回空）。
   * 旧「逐首搜索兜底」（resolveNeteaseSongUrlsBySearch/fillSongUrls）已随自建 API
   * 退役删除（#244 决策 7）；无 URL 歌曲播放时由路由层单首解析。
   */
  async resolveNeteaseSongUrls(songs: Song[]): Promise<void> {
    const ids = songs.map(s => Number(s.id)).filter(id => Number.isFinite(id) && id > 0);
    const urlMap = await this.fetchNeteaseSongUrlMap(ids);
    for (const song of songs) {
      const u = urlMap.get(Number(song.id));
      if (u) song.url = u;
    }
  },

  /**
   * 分页获取网易云歌单歌曲(详情页滚动加载用,避免一次性全量拉取)
   * @param playlistId 歌单 ID
   * @param offset 起始偏移
   * @param limit 每页数量
   * @returns 本页歌曲与歌单总曲数
   */
  async getNeteasePlaylistSongsPage(playlistId: number, offset: number = 0, limit: number = 50): Promise<{ songs: Song[]; total: number }> {
    const cacheKey = `netease_playlist_page_${playlistId}_${offset}_${limit}`;
    const cached = cacheManager.get<{ songs: Song[]; total: number }>(cacheKey);
    if (cached) return cached;

    const trackIds = await this.getNeteasePlaylistTrackIds(playlistId);
    let songs: Song[] = [];
    const pageIds = trackIds.slice(offset, offset + limit);

    if (pageIds.length > 0) {
      try {
        // 详情与播放地址互不依赖,并行请求省一个 RTT
        const [detailRes, urlMap] = await Promise.all([
          weapiRequest<{ songs?: any[] }>('/v3/song/detail', { c: JSON.stringify(pageIds.map(id => ({ id }))) }),
          this.fetchNeteaseSongUrlMap(pageIds),
        ]);
        songs = (detailRes.songs || []).map((t: any) => processNeteaseTrack(t));
        for (const song of songs) {
          const u = urlMap.get(Number(song.id));
          if (u) song.url = u;
        }
      } catch (error) {
        console.error(`[MusicApi] getNeteasePlaylistSongsPage weapi 失败,回退旧接口 (id=${playlistId}):`, error);
        try {
          const p = await fetchNeteasePlaylistLegacy(playlistId);
          songs = (p?.tracks || []).slice(offset, offset + limit).map((t: any) => processNeteaseTrack(t));
        } catch (error2) {
          console.error(`[MusicApi] getNeteasePlaylistSongsPage 失败(旧接口) (id=${playlistId}):`, error2);
        }
      }
    }

    const result = { songs, total: trackIds.length };
    // 空页不缓存(offset 越界 / 瞬时故障),避免 10 分钟内无法自愈
    if (songs.length > 0) cacheManager.set(cacheKey, result, 10 * 60 * 1000);
    return result;
  },

  /**
   * 获取网易云歌单全部歌曲(weapi 直连,精确 trackId 批量取详情)
   * 供导入/保存等需要一次性全量的场景使用;详情页请用 getNeteasePlaylistSongsPage 分页
   * @param playlistId 歌单 ID
   * @param limit 限制返回数量,0 表示全部
   */
  async getNeteasePlaylistSongs(playlistId: number, limit: number = 0): Promise<Song[]> {
    const cacheKey = `netease_playlist_songs_${playlistId}_${limit}`;
    const cached = cacheManager.get<Song[]>(cacheKey);
    if (cached) return cached;

    const trackIds = await this.getNeteasePlaylistTrackIds(playlistId);
    let songs: Song[] = [];

    // 每批最多 1000 个 id,并行取详情
    try {
      const batches: number[][] = [];
      for (let i = 0; i < trackIds.length; i += 1000) batches.push(trackIds.slice(i, i + 1000));
      const results = await Promise.all(
        batches.map(batch => weapiRequest<{ songs?: any[] }>('/v3/song/detail', { c: JSON.stringify(batch.map(id => ({ id }))) }))
      );
      for (const r of results) {
        for (const t of r.songs || []) songs.push(processNeteaseTrack(t));
      }
    } catch (error) {
      console.error(`[MusicApi] getNeteasePlaylistSongs weapi 失败,回退旧接口 (id=${playlistId}):`, error);
      try {
        const p = await fetchNeteasePlaylistLegacy(playlistId);
        songs = (p?.tracks || []).map((t: any) => processNeteaseTrack(t));
      } catch (error2) {
        console.error(`[MusicApi] getNeteasePlaylistSongs 失败(旧接口) (id=${playlistId}):`, error2);
      }
    }

    await this.resolveNeteaseSongUrls(songs);

    const result = limit > 0 ? songs.slice(0, limit) : songs;
    // 空结果不缓存,避免瞬时故障导致 10 分钟内无法自愈
    if (result.length > 0) {
      cacheManager.set(cacheKey, result, 10 * 60 * 1000);
    }
    return result;
  },

  async getNewAlbums(area: string = 'ALL', offset: number = 0, limit: number = 30): Promise<Album[]> {
    // key 必须含 offset/limit：分页参数不同返回不同数据，固定 key 会串页
    const cacheKey = `album_new_${area}_${offset}_${limit}`;
    const cached = cacheManager.get<Album[]>(cacheKey);
    if (cached) return cached;

    try {
      // weapi 直连:area 分类真实生效(ZH 华语 / EA 欧美 / KR 韩国 / JP 日本),失败回退旧接口
      const data = await weapiRequest<any>('/album/new', { area, offset, limit, total: true });
      if (data.code !== 200 || !data.albums) {
        throw new Error(`获取新碟失败 (area=${area})`);
      }
      const albums: Album[] = (data.albums as any[]).map(normalizeNeteaseAlbum);
      cacheManager.set(cacheKey, albums, ALBUMS_CACHE_TTL);
      return albums;
    } catch (error) {
      console.error(`[MusicApi] getNewAlbums weapi 失败,回退旧接口 (area=${area}):`, error);
      try {
        const neteaseClient = createNeteaseClient();
        const response = await neteaseClient.get(
          `https://music.163.com/api/album/new?area=${area}&offset=${offset}&limit=${limit}`
        );
        const data = response.data;
        if (!data?.albums) return [];

        const albums: Album[] = (data.albums as any[]).map(normalizeNeteaseAlbum);
        cacheManager.set(cacheKey, albums, ALBUMS_CACHE_TTL);
        return albums;
      } catch (error2) {
        console.error('[MusicApi] getNewAlbums 失败(旧接口):', error2);
        return [];
      }
    }
  },

  /**
   * 获取网易云专辑详情+歌曲列表(weapi 直连,单请求)
   * 专辑歌曲一般 ≤100 首;返回前补齐播放 URL(weapi by-ID 批量直链),点开即播
   */
  async getAlbumDetail(albumId: string): Promise<{ album: Album; songs: Song[] } | null> {
    const cacheKey = `album_detail_${albumId}`;
    const cached = cacheManager.get<{ album: Album; songs: Song[] }>(cacheKey);
    if (cached) return cached;

    let album: Album | null = null;
    let songs: Song[] = [];
    try {
      const data = await weapiRequest<any>(`/v1/album/${albumId}`, {});
      if (data.code !== 200 || !data.album) {
        throw new Error(`获取专辑详情失败 (albumId=${albumId})`);
      }
      album = normalizeNeteaseAlbum(data.album);
      // 专辑歌曲字段与歌单同构(ar/al/dt),复用同一映射
      songs = (data.songs || []).map((song: any) => processNeteaseTrack(song));
    } catch (error) {
      console.error(`[MusicApi] getAlbumDetail weapi 失败 (albumId=${albumId}):`, error);
      return null;
    }
    if (!album) return null;

    await this.resolveNeteaseSongUrls(songs);

    const result = { album, songs };
    // 空结果不缓存,避免瞬时故障 10 分钟内无法自愈
    if (songs.length > 0) cacheManager.set(cacheKey, result, 10 * 60 * 1000);
    return result;
  },

  /**
   * 分页获取歌手专辑列表(weapi 直连)
   * @param artistId 歌手 ID
   * @param offset 起始偏移
   * @param limit 每页数量
   */
  async getArtistAlbums(artistId: string, offset: number = 0, limit: number = 30): Promise<{ albums: Album[]; total: number; more: boolean }> {
    const cacheKey = `artist_albums_${artistId}_${offset}_${limit}`;
    const cached = cacheManager.get<{ albums: Album[]; total: number; more: boolean }>(cacheKey);
    if (cached) return cached;

    try {
      const data = await weapiRequest<any>(`/artist/albums/${artistId}`, { offset, limit, total: true });
      if (data.code !== 200) {
        throw new Error(`获取歌手专辑失败 (artistId=${artistId})`);
      }
      const rawAlbums: any[] = data.hotAlbums || data.albums || [];
      const albums = rawAlbums.map(normalizeNeteaseAlbum);
      const result = {
        albums,
        total: typeof data.total === 'number' ? data.total : albums.length + offset,
        more: data.more !== false,
      };
      cacheManager.set(cacheKey, result, 10 * 60 * 1000);
      return result;
    } catch (error) {
      console.error(`[MusicApi] getArtistAlbums 失败 (artistId=${artistId}):`, error);
      return { albums: [], total: 0, more: false };
    }
  },

  async getRecommendedPlaylists(limit: number = 30): Promise<DiscoverPlaylist[]> {
    // key 必须含 limit：接口按 limit 返回不同数量的歌单（同 getRecommendedSongs 的修复）
    const cacheKey = `personalized_playlist_${limit}`;
    const cached = cacheManager.get<DiscoverPlaylist[]>(cacheKey);
    if (cached) return cached;

    const mapResult = (result: any[]): DiscoverPlaylist[] => (result || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      coverImgUrl: (p.picUrl || p.coverImgUrl || '').replace(/^http:/, 'https:'),
      playCount: p.playCount || 0,
      trackCount: p.trackCount || 0,
      creator: p.creator ? { nickname: p.creator.nickname || '' } : { nickname: '' },
      tags: [],
      description: p.copywriter || p.description || '',
    }));

    // weapi 直连优先,失败回退旧接口
    try {
      const data = await weapiRequest<any>('/personalized/playlist', { limit });
      if (data?.code === 200 && Array.isArray(data.result)) {
        const playlists = mapResult(data.result);
        cacheManager.set(cacheKey, playlists, RECOMMENDED_CACHE_TTL);
        return playlists;
      }
      throw new Error(`weapi 返回异常 (code=${data?.code})`);
    } catch (error) {
      console.error('[MusicApi] getRecommendedPlaylists weapi 失败,回退旧接口:', error);
    }

    const neteaseClient = createNeteaseClient();
    const response = await neteaseClient.get(
      `https://music.163.com/api/personalized/playlist?limit=${limit}`
    );
    const data = response.data;
    if (!data?.result) return [];

    const playlists = mapResult(data.result);

    cacheManager.set(cacheKey, playlists, RECOMMENDED_CACHE_TTL);
    return playlists;
  },

  async getRecommendedSongs(limit: number = 30): Promise<Song[]> {
    // cacheKey 必须包含 limit：接口按 limit 返回不同数量的歌，
    // 固定 key 会导致拉 15 的缓存污染拉 100 的调用
    const cacheKey = `personalized_newsong_${limit}`;
    const cached = cacheManager.get<Song[]>(cacheKey);
    if (cached) return cached;

    const neteaseClient = createNeteaseClient();
    const response = await neteaseClient.get(
      `https://music.163.com/api/personalized/newsong?limit=${limit}`
    );
    const data = response.data;
    if (!data?.result) return [];

    const songs: Song[] = (data.result as any[]).map((s: any) => ({
      id: String(s.id),
      name: s.name || '',
      artist: (s.artists || []).map((a: any) => a.name).join(' / ') || s.song?.artists?.[0]?.name || '',
      album: s.album?.name || s.song?.album?.name || '',
      url: '',
      cover: s.album?.picUrl || s.picUrl || s.song?.album?.picUrl || '',
      lrc: '',
      duration: s.duration ? Math.floor(s.duration / 1000) : s.song?.duration ? Math.floor(s.song.duration / 1000) : 0,
      sourceType: 'netease' as const,
    }));

    cacheManager.set(cacheKey, songs, RECOMMENDED_CACHE_TTL);
    return songs;
  },


  groupIntoSongGroups(allSongs: Song[]): SongGroup[] {
    return groupIntoSongGroupsUtil(allSongs);
  },

  /**
   * 批量探测歌曲可播性（桌面换源/搜索结果探测），空 url → `invalid`。
   * 复用 core `probeSongs` + `getAudioUrl` resolver：每首先解析直链再探测。
   */
  async probeSongsBatch(songs: Song[]): Promise<{ songId: string; tag: AudioTag }[]> {
    const list = Array.isArray(songs) ? songs : [];
    if (list.length === 0) return [];
    const results: { songId: string; tag: AudioTag }[] = [];
    // 记录每首解析后的最终 URL + 直连 nonFull 判定（空 → invalid，保持桌面现状）
    const resolvedUrls = new Map<string, { url: string; nonFull: boolean }>();
    const songsById = new Map(list.map((s) => [s.id, s]));
    await probeSongs(list, {
      concurrency: Math.min(5, Math.max(1, list.length)),
      resolver: async (song) => {
        let url = song.url;
        let nonFull = false;
        try {
          // 探测只走**直连**路由（resolvePlayableSongDirect，无 tier3）：
          // 探测语义 = 「直连可播性」，单请求/首、快，且不占用 tier3 上游配额、
          // 不被 mgmp3 等慢源（20s 超时）拖死整批探测（标签秒出）。
          // 播放仍走 resolvePlayableSongRouted（含 tier3 兜底）。
          const routed = await routedResolveSongDirect(song);
          if (routed?.url?.startsWith('http')) {
            url = routed.url;
            nonFull = routed.nonFull;
          }
        } catch {
          // keep the original URL; probeAudioUrl will classify it
        }
        resolvedUrls.set(song.id, { url: url || '', nonFull });
        return url;
      },
      onResult: (songId, tag) => {
        const entry = resolvedUrls.get(songId);
        results.push({ songId, tag: entry?.url ? tag : 'invalid' });
        // 探测职责转型：打标签的同时把直连直链写入预取缓存（主进程内存，
        // TTL 30min）——播放时 resolvePlayableSongRouted 先查缓存，命中 0 等待。
        const target = songsById.get(songId);
        if (target && entry?.url) {
          rememberProbeResult(target, entry.url, tag, entry.nonFull);
        }
      },
    });
    return results;
  },

  /**
   * 模式感知搜索（来源开关 auto/direct/api，单一回退链：直连 → 自建 API）。
   * 供 SearchOrchestrator 的 searchOneSource 注入（桌面经 musicApi:call 契约，
   * 移动端 core 直调）。直连客户端由 T02+ 各源 ticket 注册。
   */
  searchSongsRouted: (query: string, page: number, source: SourceKey) =>
    routedSearchSongs(query, page, source),

  /** 模式感知播放 URL 解析（请求层回退链 URL 腿；无版权/VIP 返回 '' 交换元层）。 */
  resolvePlayableUrlRouted: (song: Song) => routedResolveUrl(song),

  /** 模式感知播放解析 + 试听版检测（T12：UrlInfo 完整时长校验 → nonFull 标记）。 */
  resolvePlayableSongRouted: (song: Song) => routedResolveSong(song),
};
