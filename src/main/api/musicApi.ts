import axios, { type AxiosInstance } from 'axios';
import type { Song } from '@/shared/types/song';
import { cacheManager } from './memoryCacheManager';
import { getCacheManager } from '../cache/cacheManager';
import { config } from '../config';
import { getHttpAgent, getHttpsAgent } from '../proxy';

import { beforeRequest, getAntiScrapeHeaders } from "./antiScrape";
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
function processSong(song: any, sourceType: 'netease' | 'qq' | 'kugou' = 'netease'): Song {
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
async searchSongs(keyword: string, page: number = 1, sourceType: 'netease' | 'qq' | 'kugou' = 'netease'): Promise<Song[]> {
    // 尝试从缓存获取
    const cachedData = cacheManager.getSearchCache(keyword, page, sourceType);
    if (cachedData) {
      console.log('搜索结果从缓存获取');
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

    // 缓存结果
    cacheManager.setSearchCache(keyword, page, sourceType, processedSongs);
    return processedSongs;
  },

  async getAudioUrl(audioUrl: string): Promise<string> {
    const fullUrl = normalizeUrl(audioUrl);
    if (!fullUrl) return '';

    // 优先检查音频文件缓存
    const cachedAudioFile = getCacheManager().getAudioCache(fullUrl);
    if (cachedAudioFile) {
      console.log('音频文件从缓存获取:', cachedAudioFile);
      return 'file://' + cachedAudioFile;
    }

    // 尝试从URL缓存获取
    const cachedData = cacheManager.getAudioUrlCache(fullUrl);
    if (cachedData) {
      console.log('音频URL从缓存获取');
      // 也尝试缓存音频文件
      this.downloadAndCacheAudio(cachedData);
      return cachedData;
    }

    try {
      const response = await apiClient.get(fullUrl, {
        maxRedirects: 5,
        validateStatus: (status) => status < 400
      });

      // 获取最终重定向后的 URL
      let finalUrl = response.request?.res?.responseUrl || response.request?.responseURL || fullUrl;
      console.log('[MusicApi] getAudioUrl - 原始URL:', fullUrl, '最终URL:', finalUrl);

      // 缓存URL结果
      cacheManager.setAudioUrlCache(fullUrl, finalUrl);

      // 后台下载并缓存音频文件
      this.downloadAndCacheAudio(finalUrl);

      return finalUrl;
    } catch (error) {
      console.error('getAudioUrl 失败:', error);
      return fullUrl;
    }
  },

  async downloadAndCacheAudio(audioUrl: string): Promise<void> {
    try {
      console.log('开始下载并缓存音频:', audioUrl);
      const response = await apiClient.get(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxRedirects: 5
      });
      const audioData = Buffer.from(response.data);
      getCacheManager().setAudioCache(audioUrl, audioData);
      getCacheManager().trimAudioCache(10);
      console.log('音频缓存成功, 大小:', audioData.length);
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
      console.log('歌词从缓存获取');
      return cachedData;
    }

    const response = await apiClient.get(fullUrl);
    const lyrics = response.data;

    // 缓存结果
    cacheManager.setLyricsCache(fullUrl, lyrics);
    return lyrics;
  },

  async batchSearch(keywords: string[], sourceType: 'netease' | 'qq' | 'kugou' = 'netease'): Promise<Record<string, Song[]>> {
    // 尝试从缓存获取
    const cachedData = cacheManager.getBatchSearchCache(keywords, sourceType);
    if (cachedData) {
      console.log('批量搜索结果从缓存获取');
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

    console.log(`批量搜索完成: ${keywords.length} 个关键词，${Object.values(batchResult).filter(songs => songs.length > 0).length} 个成功`);

    // 缓存结果
    cacheManager.setBatchSearchCache(keywords, sourceType, batchResult);
    return batchResult;
  },

  async getNeteaseHotlist(): Promise<HotlistSong[]> {
    // 尝试从缓存获取
    const cachedData = cacheManager.getHotlistCache('netease');
    if (cachedData && cachedData.length > 0) {
      console.log('网易热榜从缓存获取');
      return cachedData;
    }

    try {
      console.log('[MusicApi] getNeteaseHotlist 开始请求');
      // 创建专门的客户端来请求网易云音乐，设置正确的请求头
      const neteaseClient = axios.create({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 30000
      });

      // 请求网易云音乐热榜页面
      const response = await neteaseClient.get('https://music.163.com/discover/toplist?id=3778678');
      const html = response.data;

      // 解析 HTML 中的 textarea 内容
      const textareaMatch = html.match(/<textarea id="song-list-pre-data" style="display:none;">(.*?)<\/textarea>/s);
      if (!textareaMatch || !textareaMatch[1]) {
        throw new Error('无法找到热榜数据');
      }

      // 解析 JSON 数据
      const jsonData = JSON.parse(textareaMatch[1]);
      const songs = jsonData || [];

      // 转换为热榜歌曲格式
      const hotlistSongs: HotlistSong[] = songs.map((song: any, index: number) => {
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

      console.log('网易热榜数据获取成功，共', hotlistSongs.length, '首歌曲');

      // 缓存结果
      cacheManager.setHotlistCache('netease', hotlistSongs);
      return hotlistSongs;
    } catch (error) {
      console.error('获取网易热榜失败:', error);
      return [];
    }
  },

  async getQQHotlist(): Promise<HotlistSong[]> {
    // 尝试从缓存获取
    const cachedData = cacheManager.getHotlistCache('qq');
    if (cachedData && cachedData.length > 0) {
      console.log('QQ热榜从缓存获取');
      return cachedData;
    }

    try {
      // 使用新的 API 端点
      const requestBody = JSON.stringify({
        comm: { ct: 24 },
        toplist: {
          module: 'musicToplist.ToplistInfoServer',
          method: 'GetDetail',
          param: { topid: 4, num: 20 }
        }
      });

      await beforeRequest();
      const qqClient = axios.create({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          ...getAntiScrapeHeaders('https://y.qq.com/'),
          'Content-Type': 'application/json',
          'Referer': 'https://y.qq.com/',
        },
        timeout: 30000,
        responseType: 'json'
      });

      const response = await qqClient.post('https://u.y.qq.com/cgi-bin/musicu.fcg', requestBody);
      const data = response.data;

      // 检查响应
      if (!data || data.code !== 0 || !data.toplist?.data?.data?.song) {
        throw new Error('获取QQ音乐热榜数据失败');
      }

      const songlist = data.toplist.data.data.song;

      if (!Array.isArray(songlist)) {
        throw new Error('无法解析QQ音乐热榜数据，song不是数组');
      }

      // 转换为热榜歌曲格式
      const hotlistSongs: HotlistSong[] = [];

      for (let index = 0; index < songlist.length; index++) {
        const song = songlist[index];

        try {
          if (!song) {
            continue;
          }

          hotlistSongs.push({
            id: song.songId?.toString() || '',
            name: song.title || '',
            artists: song.singerName || '',
            rank: song.rank || index + 1,
            cover: song.cover || '',
            album: '' // API 中没有专辑信息
          });
        } catch {
          // 跳过处理失败的歌曲
        }
      }

      // 缓存结果
      cacheManager.setHotlistCache('qq', hotlistSongs);
      return hotlistSongs;
    } catch (error) {
      console.error('获取QQ音乐热榜失败:', error);
      return [];
    }
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
      console.log('[MusicApi] getNeteasePlaylists 从缓存获取');
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
      console.log('[MusicApi] getNeteasePlaylists 获取成功，数量:', playlists.length);
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
      console.log('[MusicApi] getNeteasePlaylistDetail 从缓存获取');
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
      console.log('[MusicApi] getNeteasePlaylistDetail 获取成功:', playlist.name);
      return playlist;
    } catch (error) {
      console.error('[MusicApi] getNeteasePlaylistDetail 失败:', error);
      return null;
    }
  },

  async getPlaylistSongsFromThirdParty(playlistUrl: string, sourceType: 'netease' | 'qq' | 'kugou' = 'netease'): Promise<Song[]> {
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
      console.log('[MusicApi] getPlaylistSongsFromThirdParty 歌曲数量:', keywords.length, '源:', sourceType);

      const searchResults = await this.batchSearch(keywords, sourceType);

      const songs: Song[] = [];
      for (const keyword of keywords) {
        const results = searchResults[keyword];
        if (results && results.length > 0) {
          songs.push(results[0]);
        }
      }

      console.log('[MusicApi] getPlaylistSongsFromThirdParty 搜索成功，数量:', songs.length);
      return songs;
    } catch (error) {
      console.error('[MusicApi] getPlaylistSongsFromThirdParty 失败:', error);
      return [];
    }
  }
};
