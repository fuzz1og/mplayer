import axios, { type AxiosInstance } from 'axios';
import type { Song, Artist, DiscoverPlaylist } from '@/shared/types/song';
import { cacheManager } from './memoryCacheManager';
import { getCacheManager } from '../cache/cacheManager';
import { config } from '../config';
import { getHttpAgent, getHttpsAgent } from '../proxy';

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

// 歌手名字 → 头像地址缓存（用于 HTML 爬取分类 tab 时补图）
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

async function fetchNeteaseArtistsByApi(offset: number, limit: number, initial: number): Promise<{ artists: Artist[]; total: number; more: boolean }> {
  const cacheKey = `artists_api_${offset}_${limit}_${initial}`;
  const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
  if (cached && (cached as any).artists) {
    return cached as unknown as { artists: Artist[]; total: number; more: boolean };
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

    const artists: Artist[] = rawArtists.map((a: any) => ({
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
}

async function fetchNeteaseArtistsByHtml(catId: number): Promise<{ artists: Artist[]; total: number; more: boolean }> {
  const cacheKey = `artists_html_${catId}`;
  const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
  if (cached && (cached as any).artists) {
    return cached as unknown as { artists: Artist[]; total: number; more: boolean };
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
    const artists: Artist[] = [];
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

  async getNeteaseArtists(cat: number = 1001, offset: number = 0, limit: number = 100, initial: number = -1): Promise<{ artists: Artist[]; total: number; more: boolean }> {
    if (cat === 0) {
      return fetchNeteaseArtistsByApi(offset, limit, initial);
    }
    return fetchNeteaseArtistsByHtml(cat);
  },

  async searchNeteaseArtists(keyword: string, limit: number = 30): Promise<Artist[]> {
    const cacheKey = `search_artists_${keyword}_${limit}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && Array.isArray(cached)) {
      return cached as unknown as Artist[];
    }

    try {
      const neteaseClient = axios.create({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://music.163.com/',
        },
        timeout: 30000
      });

      const response = await neteaseClient.get(`https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=100&limit=${limit}`);
      const data = response.data;
      const rawArtists: any[] = data?.result?.artists || [];

      const artists: Artist[] = rawArtists.map((a: any) => ({
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

  async getNeteaseArtistSongs(artistId: string, offset: number = 0, limit: number = 50, order: 'hot' | 'time' = 'hot'): Promise<{ songs: Song[]; total: number }> {
    const cacheKey = `artist_songs_${artistId}_${offset}_${limit}_${order}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).songs) {
      return cached as unknown as { songs: Song[]; total: number };
    }

    try {
      const neteaseClient = axios.create({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://music.163.com/',
        },
        timeout: 30000
      });

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

  async getQQHotlist(): Promise<HotlistSong[]> {
    // 尝试从缓存获取
    const cachedData = cacheManager.getHotlistCache('qq');
    if (cachedData && cachedData.length > 0) {
      console.log('QQ热榜从缓存获取');
      return cachedData;
    }

    try {
      // 获取当前日期，格式为 YYYY-MM-DD
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      // 构建请求URL
      const url = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?newsong=1&tpl=3&page=detail&date=${dateStr}&topid=4&type=top&song_begin=0&song_num=20&g_tk=5381&jsonpCallback=MusicJsonCallbacktoplist&loginUin=0&hostUin=0&format=jsonp&inCharset=GB2312&outCharset=utf-8&notice=0&platform=mac&needNewCode=0`;

      // 创建一个新的axios实例，设置适当的请求头
      const qqClient = axios.create({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        timeout: 30000,
        responseType: 'text'
      });

      const response = await qqClient.get(url);
      const data = response.data;

      // 确保数据是字符串类型
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);

      // 解析JSONP格式的数据
      const jsonpMatch = dataStr.match(/MusicJsonCallbacktoplist\(([\s\S]*)\)\s*$/);

      if (!jsonpMatch || !jsonpMatch[1]) {
        throw new Error('无法解析QQ音乐热榜数据，JSONP格式不正确');
      }

      // 解析JSON数据
      let jsonString = jsonpMatch[1].trim();

      if (!jsonString.startsWith('{') && !jsonString.startsWith('[')) {
        throw new Error('JSON字符串格式不正确');
      }

      const jsonData = JSON.parse(jsonString);

      // 检查songlist字段
      const songlist = jsonData.songlist || [];

      if (!Array.isArray(songlist)) {
        throw new Error('无法解析QQ音乐热榜数据，songlist不是数组');
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

          hotlistSongs.push({
            id: songData.id?.toString() || '',
            name: songData.name || '',
            artists: artists,
            rank: index + 1,
            cover: '', // QQ音乐热榜卡片不显示封面
            album: songData.album?.name || ''
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
        tags: p.tags || [],
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

      const p = response.data.playlist;
      if (!p) return null;

      const playlist: DiscoverPlaylist = {
        id: p.id,
        name: p.name,
        coverImgUrl: p.coverImgUrl || '',
        playCount: p.playCount || 0,
        trackCount: p.trackCount || 0,
        creator: { nickname: p.creator?.nickname || '' },
        tags: p.tags || [],
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

  async getPlaylistSongsFromThirdParty(playlistUrl: string): Promise<Song[]> {
    try {
      const response = await axios.post(
        'https://sss.unmeta.cn/songlist?detailed=false&format=song-singer&order=normal',
        `url=${encodeURIComponent(playlistUrl)}`,
        {
          headers: {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'content-type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://music.163.com/'
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
      console.log('[MusicApi] getPlaylistSongsFromThirdParty 歌曲数量:', keywords.length);

      const searchResults = await this.batchSearch(keywords, 'netease');

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
