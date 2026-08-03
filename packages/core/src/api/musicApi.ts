import axios, { type AxiosInstance } from 'axios';
import type { Song, SourceKey, SongGroup, DiscoverPlaylist, Album } from '../types/index.js';
import { cacheManager } from './memoryCacheManager.js';
import { beforeRequest, getAntiScrapeHeaders } from './antiScrape.js';
import { weapiRequest } from './neteaseWeapi.js';
import type { Agent } from 'http';

let API_BASE_URL = 'http://localhost:3000/';
let PROXY_URL = '';
const ALBUMS_CACHE_TTL = 60 * 60 * 1000;
const RECOMMENDED_CACHE_TTL = 15 * 60 * 1000;
const SODA_URL_CACHE_TTL = 10 * 60 * 1000;
const sodaAudioUrlCache = new Map<string, { url: string; expires: number }>();
export function setApiBaseUrl(url: string): void {
  API_BASE_URL = url.endsWith('/') ? url : url + '/';
  apiClient.defaults.baseURL = API_BASE_URL;
}
export function getApiBaseUrl(): string { return API_BASE_URL; }
export function setProxyUrl(url: string): void {
  PROXY_URL = url;
  if (url) {
    try {
      const parsed = new URL(url);
      apiClient.defaults.proxy = {
        host: parsed.hostname,
        port: parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
        protocol: parsed.protocol.replace(':', '') as 'http' | 'https',
      };
    } catch { apiClient.defaults.proxy = false; }
  } else {
    apiClient.defaults.proxy = false;
  }
}
export function getProxyUrl(): string { return PROXY_URL; }

export interface ProxyAgents {
  httpAgent: Agent;
  httpsAgent: Agent;
}

let _proxyAgentsProvider: (() => ProxyAgents) | null = null;
export function injectProxyAgents(provider: () => ProxyAgents): void {
  _proxyAgentsProvider = provider;
  Object.defineProperty(apiClient.defaults, 'httpAgent', { get: () => _proxyAgentsProvider!().httpAgent, configurable: true });
  Object.defineProperty(apiClient.defaults, 'httpsAgent', { get: () => _proxyAgentsProvider!().httpsAgent, configurable: true });
}

// 歌手头像缓存，供分类 tab 爬取时补图
const artistPicCache = new Map<string, string>();

// 搜索兜底状态:healthCheck 结果缓存(5 分钟)+ 搜索无结果歌曲黑名单(会话级)
const HEALTH_CHECK_TTL = 5 * 60 * 1000;
let healthCheckCache = { at: 0, ok: false };
const searchFailedSongIds = new Set<string>();

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

/** 预热热门歌手头像缓存 (top 100)，供 HTML 爬取分类歌手时补图 */
export async function warmUpArtistPicCache(): Promise<void> {
  if (artistPicCache.size > 50) return;
  try {
    const neteaseClient = createNeteaseClient();
    const res = await neteaseClient.get('https://music.163.com/api/v1/artist/list?offset=0&limit=100&initial=-1');
    const rawArtists: any[] = res.data?.artists || [];
    for (const a of rawArtists) {
      const picUrl = a.picUrl || a.img1v1Url || '';
      if (picUrl && !artistPicCache.has(a.name)) artistPicCache.set(a.name, picUrl);
    }
  } catch (e) {
    console.error('[warmUpArtistPicCache] 预热失败:', e);
  }
}

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
const apiClient = axios.create({
  get baseURL() {
    return API_BASE_URL;
  },
  headers: {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest'
  },
  proxy: false,
  timeout: 30000,
});

export function getApiClient(): AxiosInstance {
  return apiClient;
}

/**
 * 补全 URL，确保返回完整的绝对 URL
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

  // 如果是相对路径，拼接 API_BASE_URL
  if (url.startsWith('/')) {
    return API_BASE_URL + url.slice(1);
  }

  // 其他情况直接拼接
  return API_BASE_URL + url;
}

/**
 * 处理歌曲数据，补全所有 URL 字段
 */
function processSong(song: any, sourceType: SourceKey = 'netease'): Song {
  return {
    id: song.id || song.songid || '',
    name: song.name || song.songname || '',
    artist: song.artist || song.authors || '',
    album: song.album || song.albumname || '',
    url: normalizeUrl(song.url),
    cover: normalizeUrl(song.cover || song.pic),
    lrc: normalizeUrl(song.lrc || song.lyric || song.lrcurl),
    duration: song.duration || song.interval || 0,
    sourceType: song.sourceType || sourceType
  };
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

    const apiURL = 'https://api.qishui.com/luna/pc/search/track?' + params.toString();
    const response = await axios.get(apiURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    });

    const data = response.data;
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


  async fetchSodaSharePage(trackId: string): Promise<{ audioUrl: string; name: string; artist: string; cover: string } | null> {
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
      return {
        audioUrl: decodeURIComponent(audio.url),
        name: audio.trackName || '',
        artist: audio.artistName || '',
        cover: audio.coverURL || '',
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

  cacheSodaAudioUrl(trackId: string, url: string): void {
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

  async searchSongs(keyword: string, page: number = 1, sourceType: SourceKey = 'netease'): Promise<Song[]> {
    if (sourceType === 'soda') {
      return this.searchSongsSoda(keyword, page);
    }

    const cachedData = cacheManager.getSearchCache(keyword, page, sourceType);
    if (cachedData) {
      return cachedData;
    }

    const params = new URLSearchParams();
    params.append('input', keyword);
    params.append('filter', 'name');
    params.append('type', sourceType);
    params.append('page', page.toString());

    // per-request 8s 超时：多源搜索 Promise.all 等最慢源，某源挂起不能拖 30s
    const response = await apiClient.post('', params, { timeout: 8000 });
    const songs: Partial<Song>[] = response.data.data || [];

    const processedSongs = songs.map(song => processSong(song, sourceType));

    cacheManager.setSearchCache(keyword, page, sourceType, processedSongs);
    return processedSongs;
  },

  async getAudioUrl(audioUrl: string, signal?: AbortSignal): Promise<string> {
    const fullUrl = normalizeUrl(audioUrl);
    if (!fullUrl) return '';

    // 尝试从URL缓存获取
    const cachedData = cacheManager.getAudioUrlCache(fullUrl);
    if (cachedData) {
      return cachedData;
    }

    // 带重试的 URL 解析（最多 3 次尝试，指数退避）
    const MAX_RETRIES = 2;
    const BASE_TIMEOUT = 5000;
    const MAX_REDIRECTS = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      try {
        const response = await apiClient.get(fullUrl, {
          maxRedirects: MAX_REDIRECTS,
          validateStatus: (status) => status < 400,
          timeout: BASE_TIMEOUT,
          signal: signal as any,
        });

        const finalUrl = response.request?.res?.responseUrl || response.request?.responseURL || fullUrl;

        if (finalUrl.startsWith('data:text/html')) {
          const errorMsg = typeof response.data === 'string' ? response.data : '获取音频失败';
          throw new Error(errorMsg);
        }

        cacheManager.setAudioUrlCache(fullUrl, finalUrl);

        return finalUrl;
      } catch (error: any) {
        if (error.name === 'AbortError' || signal?.aborted) {
          throw error;
        }

        const isLastAttempt = attempt === MAX_RETRIES;
        if (isLastAttempt) {
          console.error('getAudioUrl 失败（已重试', MAX_RETRIES, '次）:', error);
          return fullUrl;
        }

        const delay = 500 * Math.pow(2, attempt);
        console.warn(`getAudioUrl 第 ${attempt + 1} 次失败，${delay}ms 后重试:`, error.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return fullUrl;
  },

  async getLyrics(lrcUrl: string): Promise<string> {
    const fullUrl = normalizeUrl(lrcUrl);
    if (!fullUrl) return '';

    // 尝试从缓存获取
    const cachedData = cacheManager.getLyricsCache(fullUrl);
    if (cachedData) {
      return cachedData;
    }

    const response = await apiClient.get(fullUrl);
    const lyrics = response.data;

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
      cacheManager.setLyricsCache(cacheKey, lyrics);
      return lyrics;
    } catch {
      return '';
    }
  },

  /**
   * 批量搜索
   * @param concurrency 并发上限,0 表示不限制(默认);限制可避免弱 API 排队/被打爆
   */
  async batchSearch(keywords: string[], sourceType: SourceKey = 'netease', concurrency: number = 0): Promise<Record<string, Song[]>> {
    // 尝试从缓存获取
    const cachedData = cacheManager.getBatchSearchCache(keywords, sourceType);
    if (cachedData) {
      return cachedData;
    }

    const results: Song[][] = new Array(keywords.length);
    const workerCount = concurrency > 0 ? Math.min(concurrency, keywords.length) : keywords.length;
    let nextIndex = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= keywords.length) break;
        try {
          results[i] = await this.searchSongs(keywords[i], 1, sourceType);
        } catch (error) {
          console.error(`搜索关键词 "${keywords[i]}" 失败:`, error);
          results[i] = [];
        }
      }
    });
    await Promise.all(workers);

    const batchResult: Record<string, Song[]> = {};
    keywords.forEach((keyword, index) => {
      batchResult[keyword] = results[index] || [];
    });

    // 缓存结果
    cacheManager.setBatchSearchCache(keywords, sourceType, batchResult);
    return batchResult;
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
        const item = songlist[index];

        try {
          const songData = item.data;

          if (!songData) {
            continue;
          }

          const artists = songData.singer?.map((singer: any) => singer.name).join('/') || '';
          // 通过 album.mid 构建封面 URL，确保所有歌曲都有封面
          const albumMid = songData.album?.mid || '';
          const cover = albumMid
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}_1.jpg`
            : '';

          hotlistSongs.push({
            id: songData.id?.toString() || '',
            name: songData.name || '',
            artists: artists,
            rank: index + 1,
            cover: cover,
            album: songData.album?.name || ''
          });
        } catch {
          // 跳过处理失败的歌曲
        }
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
   * 搜索兜底:剩余无 url 的歌曲(通常为 VIP)用「歌名+歌手」通过自有搜索 API 拿直链。
   * - healthCheck 结果缓存 60 秒,避免每页重复探测
   * - 搜索无结果的歌曲记入黑名单(会话级),后续页不再重复搜索
   */
  async resolveNeteaseSongUrlsBySearch(songs: Song[]): Promise<void> {
    const missingUrlSongs = songs.filter(s => !s.url && !searchFailedSongIds.has(s.id));
    if (missingUrlSongs.length === 0) return;

    const now = Date.now();
    let apiOk: boolean;
    if (now - healthCheckCache.at < HEALTH_CHECK_TTL) {
      apiOk = healthCheckCache.ok;
    } else {
      apiOk = await this.healthCheck();
      healthCheckCache = { at: now, ok: apiOk };
    }
    if (!apiOk) return;

    try {
      const keywords = missingUrlSongs.map(s => `${s.name} ${s.artist}`.trim());
      // 限 10 并发:单页搜索兜底更快,弱 API 排队仍可控
      const searchResults = await this.batchSearch(keywords, 'netease', 10);
      for (let i = 0; i < missingUrlSongs.length; i++) {
        const song = missingUrlSongs[i];
        const hit = (searchResults[keywords[i]] || []).find(h => h.url);
        if (hit?.url) {
          song.url = hit.url;
        } else {
          searchFailedSongIds.add(song.id);
        }
      }
    } catch (error) {
      console.error('[MusicApi] resolveNeteaseSongUrlsBySearch 搜索兜底失败:', error);
    }
  },

  /**
   * 批量补齐歌曲可播放 URL(全量场景用):weapi 批量直连 + 搜索兜底
   * @param skipSearchFallback 为 true 时跳过逐首搜索兜底(慢),适合移动端详情页:
   *   无 URL 歌曲播放时再由 resolvePlayableUrl 单首解析,避免进入详情页长时间等待
   */
  async resolveNeteaseSongUrls(songs: Song[], skipSearchFallback: boolean = false): Promise<void> {
    const ids = songs.map(s => Number(s.id)).filter(id => Number.isFinite(id) && id > 0);
    const urlMap = await this.fetchNeteaseSongUrlMap(ids);
    for (const song of songs) {
      const u = urlMap.get(Number(song.id));
      if (u) song.url = u;
    }
    if (!skipSearchFallback) {
      await this.resolveNeteaseSongUrlsBySearch(songs);
    }
  },

  /**
   * 分页获取网易云歌单歌曲(详情页滚动加载用,避免一次性全量拉取)
   * @param playlistId 歌单 ID
   * @param offset 起始偏移
   * @param limit 每页数量
   * @returns 本页歌曲与歌单总曲数
   */
  async getNeteasePlaylistSongsPage(playlistId: number, offset: number = 0, limit: number = 50, skipSearchFallback: boolean = false): Promise<{ songs: Song[]; total: number }> {
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
      if (!skipSearchFallback) {
        await this.resolveNeteaseSongUrlsBySearch(songs);
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
    const cacheKey = `album_new_${area}`;
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
   * 专辑歌曲一般 ≤100 首;返回前补齐播放 URL(批量直链 + 搜索兜底),点开即播
   */
  async getAlbumDetail(albumId: string, skipSearchFallback: boolean = false): Promise<{ album: Album; songs: Song[] } | null> {
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

    await this.resolveNeteaseSongUrls(songs, skipSearchFallback);

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
    const cacheKey = 'personalized_playlist';
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
    const map = new Map<string, SongGroup>();
    for (const song of allSongs) {
      const key = `${song.name.trim().toLowerCase()}|${song.artist.trim().toLowerCase()}`;
      const existing = map.get(key);
      if (existing) {
        existing.songs.push(song);
      } else {
        map.set(key, { key, name: song.name, artist: song.artist, songs: [song] });
      }
    }
    return Array.from(map.values());
  },

  async searchAllSources(keyword: string, page: number = 1): Promise<SongGroup[]> {
    // migu 不在列表：摄取端点无 migu 数据源，实测最慢(1.1s)且永远返回空，白等
    const sources: SourceKey[] = ['netease', 'qq', 'kugou', 'kuwo', 'qianqian', 'soda'];
    const results = await Promise.allSettled(
      sources.map(async (src) => {
        const t0 = Date.now();
        try {
          const songs = await this.searchSongs(keyword, page, src);
          console.log(`[search:${src}] ${Date.now() - t0}ms ${songs.length}首`);
          return songs;
        } catch (e: any) {
          console.log(`[search:${src}] ${Date.now() - t0}ms FAILED`);
          throw e;
        }
      })
    );
    const allSongs: Song[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        allSongs.push(...r.value);
      }
    }
    return this.groupIntoSongGroups(allSongs);
  },

  async getPlaylistSongsFromThirdParty(playlistUrl: string, sourceType: SourceKey = 'netease'): Promise<Song[]> {
    try {
      // Note: unmeta.cn auto-detects the music source from the URL
      // sourceType is used for local search (batchSearch) after getting song names
      const response = await axios.post(
        'https://sss.unmeta.cn/songlist?detailed=false&format=song-singer&order=normal',
        `url=${encodeURIComponent(playlistUrl)}`,
        {
          headers: {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'content-type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://music.unmeta.cn/',
            'Origin': 'https://music.unmeta.cn'
          },
          timeout: 30000
        }
      );

      const data = response.data;
      if (data.code !== 1 || !data.data?.songs) {
        console.error('[MusicApi] getPlaylistSongsFromThirdParty 失败:', data.msg);
        return [];
      }

      const keywords = data.data.songs.map((s: string) => s.trim()).filter(Boolean);

      const searchResults = await this.batchSearch(keywords, sourceType);

      const songs: Song[] = [];
      for (const keyword of keywords) {
        const results = searchResults[keyword];
        if (results && results.length > 0) {
          songs.push(results[0]);
        }
      }

      return songs;
    } catch (error) {
      console.error('[MusicApi] getPlaylistSongsFromThirdParty 失败:', error);
      return [];
    }
  },

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams();
      params.append('input', '稻香');
      params.append('filter', 'name');
      params.append('type', 'netease');
      params.append('page', '1');
      // 探测用短超时:API 慢时快速失败,不拖慢页面加载
      const response = await apiClient.post('', params, { timeout: 3000 });
      const data = response.data?.data;
      return Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    }
  },

  async warmUpArtistPicCache(): Promise<void> {
    return warmUpArtistPicCache();
  }
};
