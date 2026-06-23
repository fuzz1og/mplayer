import axios, { type AxiosInstance } from 'axios';
import type { Song, DiscoverPlaylist, SongGroup } from '@/shared/types/song';
import { cacheManager } from './memoryCacheManager';
import { getCacheManager } from '../cache/cacheManager';
import { config } from '../config';
import { getHttpAgent, getHttpsAgent } from '../proxy';

import { beforeRequest, getAntiScrapeHeaders } from "./antiScrape";

type SourceKey = 'netease' | 'qq' | 'kugou' | 'migu' | 'kuwo' | 'qianqian' | 'soda';

// 歌手头像缓存，供分类 tab 爬取时补图
const artistPicCache = new Map<string, string>();

function createNeteaseClient() {
  return axios.create({
    httpAgent: getHttpAgent(),
    httpsAgent: getHttpsAgent(),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://music.163.com/',
    },
    timeout: 30000
  });
}
const apiClient = axios.create({
  get baseURL() {
    return config.API_BASE_URL;
  },
  get httpAgent() {
    return getHttpAgent();
  },
  get httpsAgent() {
    return getHttpsAgent();
  },
  headers: {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest'
  },
  timeout: 30000
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

  // 如果是相对路径，拼接 config.API_BASE_URL
  if (url.startsWith('/')) {
    return config.API_BASE_URL + url.slice(1);
  }

  // 其他情况直接拼接
  return config.API_BASE_URL + url;
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
   * 注：搜索结果不含 audio_url，播放时需通过 getSodaAudioUrl 获取
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
      httpAgent: getHttpAgent(),
      httpsAgent: getHttpsAgent(),
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
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
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
    const page = await this.fetchSodaSharePage(trackId);
    if (page?.audioUrl) return page.audioUrl;

    const params = new URLSearchParams();
    params.set('track_id', trackId);
    params.set('media_type', 'track');
    params.set('aid', '386088');
    params.set('device_platform', 'web');
    params.set('channel', 'pc_web');

    const apiURL = 'https://api.qishui.com/luna/pc/track_v2?' + params.toString();
    try {
      const response = await axios.get(apiURL, {
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
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
      return auth ? `${audioUrl}?play_auth=${encodeURIComponent(auth)}` : audioUrl;
    } catch (error) {
      console.error('获取汽水音乐音频 URL 失败:', error);
      return '';
    }
  },

  /**
   * 获取汽水音乐播放用 URL（下载到缓存，返回 file:// 路径，避免渲染器 CORS 问题）
   */
  async getSodaPlayableUrl(trackId: string): Promise<string> {
    const remoteUrl = await this.getSodaAudioUrl(trackId);
    if (!remoteUrl) return '';

    const cached = getCacheManager().getAudioCache(`soda_${trackId}`);
    if (cached) {
      return 'file:///' + cached.replace(/\\/g, '/');
    }

    try {
      const dl = await axios.get(remoteUrl, {
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const audioData = Buffer.from(dl.data);
      getCacheManager().setAudioCache(`soda_${trackId}`, audioData);
      const cachedFile = getCacheManager().getAudioCache(`soda_${trackId}`);
      if (cachedFile) {
        return 'file:///' + cachedFile.replace(/\\/g, '/');
      }
    } catch (dlErr) {
      console.error('下载汽水音频到缓存失败，回退直链:', dlErr);
    }
    return remoteUrl;
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
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
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

    const response = await apiClient.post('', params);
    const songs: Partial<Song>[] = response.data.data || [];

    const processedSongs = songs.map(song => processSong(song, sourceType));

    cacheManager.setSearchCache(keyword, page, sourceType, processedSongs);
    return processedSongs;
  },

  async getAudioUrl(audioUrl: string): Promise<string> {
    const fullUrl = normalizeUrl(audioUrl);
    if (!fullUrl) return '';

    // 优先检查音频文件缓存
    const cachedAudioFile = getCacheManager().getAudioCache(fullUrl);
    if (cachedAudioFile) {
      return 'file://' + cachedAudioFile;
    }

    // 尝试从URL缓存获取
    const cachedData = cacheManager.getAudioUrlCache(fullUrl);
    if (cachedData) {
      // 也尝试缓存音频文件
      this.downloadAndCacheAudio(cachedData, fullUrl);
      return cachedData;
    }

    try {
      const response = await apiClient.get(fullUrl, {
        maxRedirects: 5,
        validateStatus: (status) => status < 400
      });

      // 获取最终重定向后的 URL
      let finalUrl = response.request?.res?.responseUrl || response.request?.responseURL || fullUrl;

      // 检查是否是错误响应（API 服务器返回 data:text/html 格式的错误消息）
      if (finalUrl.startsWith('data:text/html')) {
        const errorMsg = typeof response.data === 'string' ? response.data : '获取音频失败';
        throw new Error(errorMsg);
      }

      // 缓存URL结果
      cacheManager.setAudioUrlCache(fullUrl, finalUrl);

      // 后台下载并缓存音频文件（传递原始 URL 作为缓存 key）
      this.downloadAndCacheAudio(finalUrl, fullUrl);

      return finalUrl;
    } catch (error) {
      console.error('getAudioUrl 失败:', error);
      throw error;
    }
  },

  async downloadAndCacheAudio(audioUrl: string, originalUrl?: string): Promise<void> {
    try {
      const response = await apiClient.get(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxRedirects: 5
      });
      const audioData = Buffer.from(response.data);
      // 使用原始 URL 作为缓存 key，与 getAudioUrl 的查询 key 一致
      getCacheManager().setAudioCache(originalUrl || audioUrl, audioData);
      getCacheManager().trimAudioCache(10);
    } catch (error) {
      console.error('音频缓存失败:', error);
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

    const response = await apiClient.get(fullUrl);
    const lyrics = response.data;

    // 缓存结果
    cacheManager.setLyricsCache(fullUrl, lyrics);
    return lyrics;
  },

  async batchSearch(keywords: string[], sourceType: SourceKey = 'netease'): Promise<Record<string, Song[]>> {
    // 尝试从缓存获取
    const cachedData = cacheManager.getBatchSearchCache(keywords, sourceType);
    if (cachedData) {
      return cachedData;
    }

    const promises = keywords.map(keyword =>
      this.searchSongs(keyword, 1, sourceType).catch(error => {
        console.error(`搜索关键词 "${keyword}" 失败:`, error);
        return []; // 返回空数组表示该关键词搜索失败
      })
    );

    // 使用 Promise.allSettled() 替代 Promise.all()
    const settledResults = await Promise.allSettled(promises);

    const batchResult: Record<string, Song[]> = {};
    keywords.forEach((keyword, index) => {
      const result = settledResults[index];
      if (result.status === 'fulfilled') {
        batchResult[keyword] = result.value;
      } else {
        console.error(`搜索关键词 "${keyword}" 失败:`, result.reason);
        batchResult[keyword] = [];
      }
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

    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=100&limit=${limit}`);
      const data = response.data;
      const rawArtists: any[] = data?.result?.artists || [];

      const artists = rawArtists.map((a: any) => ({
        id: String(a.id),
        name: a.name || '',
        picUrl: a.picUrl || '',
        alias: a.alias || [],
        trans: a.trans || undefined,
        albumSize: a.albumSize || 0,
        musicSize: a.musicSize || 0,
        sourceType: 'netease'
      }));

      cacheManager.setSearchCache(cacheKey, 1, 'netease', artists as any);
      return artists;
    } catch (error) {
      console.error('搜索歌手失败:', error);
      return [];
    }
  },

  async getNeteaseArtists(cat: number = 1001, offset: number = 0, limit: number = 100, initial: number = -1): Promise<{ artists: any[]; total: number; more: boolean }> {
    if (cat === 0) {
      return this.fetchNeteaseArtistsByApi(offset, limit, initial);
    }
    return this.fetchNeteaseArtistsByHtml(cat);
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
        console.error('未找到歌手列表数据');
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

    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(`https://music.163.com/api/v1/artist/songs?id=${artistId}&offset=${offset}&limit=${limit}&order=${order}`);
      const data = response.data;
      const rawSongs: any[] = data.songs || [];
      const total = data.total || 0;

      const songs: Song[] = rawSongs.map((song: any) => processSong({
        id: String(song.id),
        name: song.name,
        artist: (song.artists || []).map((a: any) => a.name).join('/'),
        album: song.album?.name || '',
        cover: song.album?.picUrl || '',
        duration: song.dt || song.duration || 0,
      }, 'netease'));

      const result = { songs, total };
      cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
      return result;
    } catch (error) {
      console.error('获取歌手歌曲失败:', error);
      return { songs: [], total: 0 };
    }
  },

  /**
   * 网易云音乐排行榜通用方法
   * @param playlistId 歌单 ID（热歌榜 3778678，新歌榜 3779629）
   * @param cacheKey 缓存键
   */
  async getNeteaseToplist(playlistId: number, cacheKey: string): Promise<HotlistSong[]> {
    const cachedData = cacheManager.getHotlistCache(cacheKey);
    if (cachedData && cachedData.length > 0) {
      return cachedData;
    }

    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(`https://music.163.com/api/playlist/detail?id=${playlistId}`);
      const data = response.data;

      if (data.code !== 200 || !data.result?.tracks) {
        throw new Error(`获取网易排行榜数据失败 (playlistId=${playlistId})`);
      }

      const tracks = data.result.tracks;

      const hotlistSongs: HotlistSong[] = tracks.map((song: any, index: number) => {
        const artists = song.artists.map((artist: any) => artist.name).join('/');
        const cover = song.album?.picUrl || '';

        return {
          id: song.id.toString(),
          name: song.name,
          artists: artists,
          rank: index + 1,
          cover: cover,
          album: song.album?.name || ''
        };
      });

      cacheManager.setHotlistCache(cacheKey, hotlistSongs);
      return hotlistSongs;
    } catch (error) {
      console.error(`获取网易排行榜失败 (cacheKey=${cacheKey}):`, error);
      return [];
    }
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
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          ...getAntiScrapeHeaders('https://y.qq.com/'),
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://y.qq.com/',
        },
        timeout: 30000,
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
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          'accept': 'application/json, text/javascript, */*; q=0.01',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://music.163.com/'
        },
        timeout: 30000
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

    try {
      const neteaseClient = axios.create({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          'accept': 'application/json, text/javascript, */*; q=0.01',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://music.163.com/'
        },
        timeout: 30000
      });

      const response = await neteaseClient.get(
        `https://music.163.com/api/playlist/detail?id=${id}`
      );

      const p = response.data.result || response.data.playlist;
      if (!p) return null;

      const playlist: DiscoverPlaylist = {
        id: p.id,
        name: p.name,
        coverImgUrl: p.coverImgUrl || '',
        playCount: p.playCount || 0,
        trackCount: p.trackCount || 0,
        creator: { nickname: p.creator?.nickname || '' },
        tags: (p.tags || []).map((t: any) => typeof t === "string" ? t : t.name || ""),
        description: p.description || ''
      };

      cacheManager.set(cacheKey, playlist, 5 * 60 * 1000);
      return playlist;
    } catch (error) {
      console.error('[MusicApi] getNeteasePlaylistDetail 失败:', error);
      return null;
    }
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
    const sources: SourceKey[] = ['netease', 'qq', 'kugou', 'migu', 'kuwo', 'qianqian', 'soda'];
    const results = await Promise.allSettled(
      sources.map(src => this.searchSongs(keyword, page, src))
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
          httpAgent: getHttpAgent(),
          httpsAgent: getHttpsAgent(),
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
  }
};
