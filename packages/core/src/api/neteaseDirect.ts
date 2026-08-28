import type { Album, Artist, DiscoverPlaylist, Song } from '../types/index.js';
import type { ContentCache, DirectSourceClient, ToplistGroup } from '../shared/sourceRouter.js';
import type { UrlInfo } from '../shared/playability.js';
import { request, bodyToText } from './transport.js';
import { weapiRequest } from './neteaseWeapi.js';
import { getUserAgent } from './antiScrape.js';
import { cacheManager } from './memoryCacheManager.js';

/**
 * 网易云直连客户端（T02 #148；内容能力面 #278）。
 *
 * 直连替代自建 API 的请求（均匿名，无需任何 cookie）：
 * - 搜索：明文 `POST music.163.com/api/cloudsearch/pc`（form `s/type:1/limit/offset`）。
 * - 播放 URL：weapi `/song/enhance/player/url/v1`（level standard、encodeType mp3）。
 *   VIP/无版权 → 返回空 URL，交给换元层 / 明确不可播，不走试听。
 * - 内容能力（#239/#240，自 musicApi 门面迁入）：榜单/推荐/歌单/歌手/专辑，
 *   weapi 优先、旧明文接口兜底；全部经 transport.request 接缝出网（双端可用）。
 *
 * **歌词内聚（#242）**：网易直连接口天然不带歌词字段（cloudsearch 实测无 lrc），
 * 内容方法返回前内部 `fillLyrics` 按 songId 批量拉词填 `Song.lrc`（LRC 文本内联，
 * 非取词 URL）——消费端拿到即完整 Song，播放期无需再按 songId 取词。
 * 缓存 key `lyric_id_${songId}`、TTL 1 天、命中零请求、空词也缓存。
 *
 * `resolveUrlInfo` 提供权威完整时长验证字段（url/br/size/playTime/fee/payed）。
 */

const CLOUDSEARCH_URL = 'https://music.163.com/api/cloudsearch/pc';
const PAGE_SIZE = 30;
const LYRIC_URL = 'https://music.163.com/api/song/lyric';

// ── 缓存 TTL（对齐门面旧语义）──────────────────────────────────────
const TOPLIST_TTL_MS = 24 * 60 * 60 * 1000;      // 榜单 1 天（原 hotlist 缓存）
const LYRIC_TTL_MS = 24 * 60 * 60 * 1000;        // 歌词 1 天（原 getLyricsBySongId）
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;        // 搜索/歌手 6h（原 search 缓存）
const PLAYLIST_TTL_MS = 5 * 60 * 1000;           // 歌单列表/详情 5min
const PAGE_TTL_MS = 10 * 60 * 1000;              // 歌单歌曲/专辑详情/歌手专辑 10min
const ALBUMS_TTL_MS = 60 * 60 * 1000;            // 新碟 1h
const RECOMMENDED_TTL_MS = 15 * 60 * 1000;       // 推荐 15min

/** fillLyrics 单次调用请求预算：防歌词端点故障把整页拖死（超时剩余歌留空，
 *  播放期由搜索兜底补词）；并发上限实测 8 并发不被限。 */
const FILL_CONCURRENCY = 8;
const FILL_BUDGET_MS = 10_000;

/** 网易云榜单定义（热歌榜/新歌榜，playlistId 与门面时代一致）。 */
const NETEASE_TOPLISTS: { sourceId: number; name: string }[] = [
  { sourceId: 3778678, name: '热歌榜' },
  { sourceId: 3779629, name: '新歌榜' },
];

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

/** 明文接口统一请求头（浏览器特征，防盗链/风控）。 */
const PLAINTEXT_HEADERS: Record<string, string> = {
  'accept': 'application/json, text/javascript, */*; q=0.01',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://music.163.com/',
};

/** 明文 GET（transport 接缝出网）→ 文本。 */
async function plaintextGetText(url: string): Promise<string> {
  const res = await request({
    method: 'GET',
    url,
    headers: PLAINTEXT_HEADERS,
    timeoutMs: 30000,
  });
  if (res.status >= 400) {
    throw new Error(`网易明文接口 HTTP ${res.status}: ${url}`);
  }
  return bodyToText(res.body);
}

/** 明文 GET → JSON。 */
async function plaintextGetJson<T>(url: string): Promise<T> {
  const text = await plaintextGetText(url);
  return JSON.parse(text) as T;
}

/** cloudsearch 返回的网易原生 track → Song（字段映射对齐门面 processNeteaseTrack）。 */
function mapTrack(t: any): Song {
  const artists = t.ar || t.artists || [];
  const album = t.al || t.album || {};
  return {
    id: String(t.id),
    name: (t.name as string) || '',
    artist: (artists as any[]).map((a: any) => a?.name || '').filter(Boolean).join(' / '),
    album: (album.name as string) || '',
    url: '',
    cover: ((album.picUrl as string) || '').replace(/^http:/, 'https:'),
    lrc: '',
    duration: t.dt ? Math.floor((t.dt as number) / 1000) : Math.floor((t.duration || 0) / 1000) || 0,
    sourceType: 'netease',
  };
}

/** 网易云专辑字段统一映射（weapi artist 单对象 / 旧接口 artists 数组，兼容两种形状）。 */
function normalizeNeteaseAlbum(raw: any): Album {
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

function mapArtist(a: any): Artist {
  return {
    id: String(a.id),
    name: a.name || '',
    picUrl: (a.picUrl || a.img1v1Url || '').replace(/^http:/, 'https:'),
    alias: a.alias || [],
    trans: a.trans || undefined,
    albumSize: a.albumSize || 0,
    musicSize: a.musicSize || 0,
    sourceType: 'netease',
  };
}

/** 歌手头像缓存，供 HTML 爬取分类歌手时补图（原门面 artistPicCache 迁入）。 */
const artistPicCache = new Map<string, string>();

/** 兜底：旧明文接口（无加密）获取网易云歌单，返回 playlist 对象或 null。 */
async function fetchNeteasePlaylistLegacy(playlistId: number): Promise<any | null> {
  const data = await plaintextGetJson<any>(`https://music.163.com/api/playlist/detail?id=${playlistId}`);
  const p = data.result || data.playlist;
  return p || null;
}

/** weapi 全量取歌单 trackIds（分页与全量共用，避免重复请求歌单元信息）。 */
async function fetchNeteasePlaylistTrackIds(playlistId: number): Promise<number[]> {
  try {
    const detail = await weapiRequest<{ code: number; playlist?: any }>('/v6/playlist/detail', { id: playlistId, n: 100000, s: 8 });
    if (detail.code !== 200 || !detail.playlist) {
      throw new Error(`获取网易云歌单失败 (id=${playlistId})`);
    }
    return (detail.playlist.trackIds || []).map((t: any) => t.id);
  } catch (error) {
    console.error(`[neteaseDirect] 取歌单 trackIds weapi 失败,回退旧接口 (id=${playlistId}):`, error);
    try {
      const p = await fetchNeteasePlaylistLegacy(playlistId);
      return (p?.tracks || []).map((t: any) => t.id);
    } catch (error2) {
      console.error(`[neteaseDirect] 取歌单 trackIds 失败(旧接口) (id=${playlistId}):`, error2);
      return [];
    }
  }
}

/**
 * weapi 批量取歌曲播放地址（id → url），免费歌曲全覆盖，VIP 歌返回空。
 */
async function fetchNeteaseSongUrlMap(ids: number[]): Promise<Map<number, string>> {
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
    console.error('[neteaseDirect] fetchNeteaseSongUrlMap 失败:', error);
  }
  return urlMap;
}

/** 按网易云 songId 拉歌词文本（LRC）；无歌词（纯音乐等）返回空串。 */
async function fetchLyricBySongId(songId: string): Promise<string> {
  const data = await plaintextGetJson<{ lrc?: { lyric?: string } }>(
    `${LYRIC_URL}?id=${encodeURIComponent(songId)}&lv=1&kv=1&tv=-1`
  );
  return data.lrc?.lyric || '';
}

/**
 * 网易歌词内聚（#242）：内容方法返回前按 songId 批量拉词填 `Song.lrc`（内联 LRC 文本）。
 * - 缓存经 ContentCache（构造注入，默认 cacheManager），key `lyric_id_${songId}`、TTL 1 天
 *   （复用歌词缓存语义）；命中零请求，防刷新页面大量拉词；
 * - **空词也缓存**（值包 `{v}` 对象以区分「无缓存」与「确认无词」——纯音乐/无词歌
 *   不再反复请求；此为 #242 对 #246「空歌词不入库」的显式反转）；
 * - 拉取失败不缓存（保留重试机会）、单首失败不影响整表；
 * - 总预算 10s：超时剩余歌留空，播放期由搜索兜底补词。
 */
async function fillLyrics(songs: Song[], cache: ContentCache): Promise<void> {
  const targets = songs.filter((s) => s.sourceType === 'netease' && s.id && !s.lrc);
  if (targets.length === 0) return;
  const uncached: Song[] = [];
  for (const s of targets) {
    const hit = cache.get<{ v: string }>(`lyric_id_${s.id}`);
    if (hit) {
      if (hit.v) s.lrc = hit.v;
    } else {
      uncached.push(s);
    }
  }
  if (uncached.length === 0) return;
  const deadline = Date.now() + FILL_BUDGET_MS;
  let idx = 0;
  const workers = Array.from({ length: Math.min(FILL_CONCURRENCY, uncached.length) }, async () => {
    while (idx < uncached.length && Date.now() < deadline) {
      const song = uncached[idx++];
      try {
        const lrc = await fetchLyricBySongId(song.id);
        cache.set(`lyric_id_${song.id}`, { v: lrc }, LYRIC_TTL_MS);
        if (lrc) song.lrc = lrc;
      } catch {
        // 单首失败不影响整表
      }
    }
  });
  await Promise.all(workers);
}

/** 明文 cloudsearch 搜索 → Song[]（无歌词字段，lrc 由 fillLyrics 内聚填充）。 */
async function neteaseSearchSongs(keyword: string, page = 1): Promise<Song[]> {
  const params = new URLSearchParams({
    s: keyword,
    type: '1',
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  const res = await request({
    method: 'POST',
    url: CLOUDSEARCH_URL,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': getUserAgent('netease'),
      'Referer': 'https://music.163.com/',
    },
    body: params.toString(),
    timeoutMs: 8000,
  });
  if (typeof res.body !== 'string') {
    throw new Error('cloudsearch 响应非文本');
  }
  const data = JSON.parse(res.body) as { code: number; message?: string; result?: { songs?: any[] } };
  if (data.code !== 200) {
    throw new Error(`cloudsearch code=${data.code} ${data.message || ''}`);
  }
  return (data.result?.songs || []).map(mapTrack);
}

/** weapi 播放 URL 权威完整时长验证字段（T12 预检用）。无版权/VIP → null。 */
async function neteaseResolveUrlInfo(song: Song): Promise<UrlInfo | null> {
  const data = await weapiRequest<{
    code: number;
    data?: {
      id?: number;
      url?: string;
      br?: number;
      size?: number;
      playTime?: number;
      time?: number;
      fee?: number;
      payed?: number;
      code?: number;
    }[];
  }>('/song/enhance/player/url/v1', {
    ids: '[' + song.id + ']',
    level: 'standard',
    encodeType: 'mp3',
  });
  if (data.code !== 200 || !data.data?.length) return null;
  const it = data.data[0];
  if (!it.url) return null;
  return {
    url: it.url.replace(/^http:/, 'https:'),
    br: it.br || 0,
    size: it.size || 0,
    playTime: it.playTime ?? it.time ?? 0,
    fee: it.fee ?? 0,
    payed: it.payed ?? 0,
  };
}

/** weapi 一次请求拉榜单全量 tracks；失败回退旧明文接口。 */
async function fetchToplistSongs(playlistId: number): Promise<Song[]> {
  const tracks: any[] = [];
  try {
    const data = await weapiRequest<any>('/v6/playlist/detail', { id: playlistId, n: 100000, s: 8 });
    if (data.code !== 200 || !data.playlist?.tracks) {
      throw new Error(`获取网易排行榜数据失败 (playlistId=${playlistId})`);
    }
    tracks.push(...data.playlist.tracks);
  } catch (error) {
    console.error(`[neteaseDirect] 获取网易排行榜失败 (playlistId=${playlistId}),回退旧接口:`, error);
    try {
      const p = await fetchNeteasePlaylistLegacy(playlistId);
      if (p?.tracks) tracks.push(...p.tracks);
    } catch (error2) {
      console.error(`[neteaseDirect] 获取网易排行榜失败(旧接口) (playlistId=${playlistId}):`, error2);
    }
  }
  return tracks.map(mapTrack);
}

// ── 歌手分类列表（weapi → 旧接口 → HTML 爬取，三段兜底原样迁入）────────

async function fetchArtistsByWeapi(
  type: number,
  area: number,
  offset: number,
  limit: number,
  initial: number,
  cache: ContentCache,
): Promise<{ artists: Artist[]; total: number; more: boolean; ok: boolean }> {
  const cacheKey = `artists_weapi_${type}_${area}_${offset}_${limit}_${initial}`;
  const cached = cache.get<{ artists: Artist[]; total: number; more: boolean; ok: boolean }>(cacheKey);
  if (cached) return cached;
  try {
    const data = await weapiRequest<any>('/v1/artist/list', { type, area, initial, offset, limit, total: true });
    if (data.code !== 200 || !data.artists) {
      throw new Error(`获取歌手列表失败 (type=${type}, area=${area})`);
    }
    const artists = (data.artists as any[]).map(mapArtist);
    for (const a of artists) {
      if (a.picUrl && !artistPicCache.has(a.name)) artistPicCache.set(a.name, a.picUrl);
    }
    const result = { artists, total: artists.length, more: data.more !== false, ok: true };
    cache.set(cacheKey, result, SEARCH_TTL_MS);
    return result;
  } catch (error) {
    console.error('[neteaseDirect] 获取歌手列表失败(weapi):', error);
    return { artists: [], total: 0, more: false, ok: false };
  }
}

async function fetchArtistsByApi(offset: number, limit: number, initial: number, cache: ContentCache): Promise<{ artists: Artist[]; total: number; more: boolean }> {
  const cacheKey = `artists_api_${offset}_${limit}_${initial}`;
  const cached = cache.get<{ artists: Artist[]; total: number; more: boolean }>(cacheKey);
  if (cached) return cached;
  try {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit), initial: String(initial) });
    const data = await plaintextGetJson<any>(`https://music.163.com/api/v1/artist/list?${params.toString()}`);
    const rawArtists: any[] = data?.artists || [];
    const more: boolean = data?.more || false;
    const artists = rawArtists.map(mapArtist);
    for (const a of artists) {
      if (a.picUrl && !artistPicCache.has(a.name)) artistPicCache.set(a.name, a.picUrl);
    }
    const result = { artists, total: artists.length, more };
    cache.set(cacheKey, result, SEARCH_TTL_MS);
    return result;
  } catch (error) {
    console.error('[neteaseDirect] 获取歌手列表失败(旧接口):', error);
    return { artists: [], total: 0, more: false };
  }
}

async function fetchArtistsByHtml(catId: number, cache: ContentCache): Promise<{ artists: Artist[]; total: number; more: boolean }> {
  const cacheKey = `artists_html_${catId}`;
  const cached = cache.get<{ artists: Artist[]; total: number; more: boolean }>(cacheKey);
  if (cached) return cached;
  try {
    const html = await plaintextGetText(`https://music.163.com/discover/artist/cat?id=${catId}`);
    const artistBoxMatch = html.match(/id="m-artist-box">(.*?)<\/ul>/s);
    if (!artistBoxMatch) {
      console.error('[neteaseDirect] fetchArtistsByHtml 未找到歌手列表数据');
      return { artists: [], total: 0, more: false };
    }

    const box = artistBoxMatch[1];
    const itemRegex = /<li[^>]*>(.*?)<\/li>/gs;
    const artists: Artist[] = [];
    let itemMatch: RegExpExecArray | null;
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
        sourceType: 'netease',
      });
    }

    // 对 HTML 解析后仍缺图的歌手，限制并发补图（冷门歌手兜底）
    const CONCURRENCY = 6;
    const artistsNeedingPic = artists.filter((a) => !a.picUrl);
    for (let i = 0; i < artistsNeedingPic.length; i += CONCURRENCY) {
      const batch = artistsNeedingPic.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (a) => {
        try {
          const detail = await plaintextGetJson<any>(`https://music.163.com/api/artist?id=${a.id}`);
          a.picUrl = detail?.artist?.picUrl || detail?.artist?.img1v1Url || '';
          if (a.picUrl) artistPicCache.set(a.name, a.picUrl);
        } catch {}
      }));
    }

    const result = { artists, total: artists.length, more: false };
    cache.set(cacheKey, result, SEARCH_TTL_MS);
    return result;
  } catch (error) {
    console.error('[neteaseDirect] 获取歌手列表失败(HTML):', error);
    return { artists: [], total: 0, more: false };
  }
}

/** 歌手单曲信息（明文 api/artist?id=，getArtistDetail 用）。 */
async function fetchArtistInfo(artistId: string): Promise<Artist | null> {
  try {
    const data = await plaintextGetJson<any>(`https://music.163.com/api/artist?id=${artistId}`);
    return data?.artist ? mapArtist(data.artist) : null;
  } catch {
    return null;
  }
}

/** 默认 ContentCache（D6）：包一层 cacheManager，TTL 由调用方显式传。 */
export const defaultContentCache: ContentCache = {
  get: <T,>(key: string) => cacheManager.get<T>(key),
  set: <T,>(key: string, data: T, ttlMs: number) => cacheManager.set(key, data, ttlMs),
};

/**
 * 网易直连客户端工厂（D6 构造注入 ContentCache，默认 cacheManager）。
 * 测试可注入内存假缓存验证 fillLyrics 缓存语义（命中零请求/空词也缓存）。
 */
export function createNeteaseDirectClient(contentCache: ContentCache = defaultContentCache): DirectSourceClient {
  return {
    key: 'netease',

    /** 明文 cloudsearch 搜索；返回前 fillLyrics 内联歌词（#242）。 */
    async searchSongs(keyword: string, page = 1): Promise<Song[]> {
      const songs = await neteaseSearchSongs(keyword, page);
      await fillLyrics(songs, contentCache);
      return songs;
    },

    /** weapi 播放 URL；VIP/无版权返回空串 → 交给换元层 / 明确不可播。 */
    async resolvePlayableUrl(song: Song): Promise<string> {
      const info = await neteaseResolveUrlInfo(song);
      return info?.url || '';
    },

    resolveUrlInfo: neteaseResolveUrlInfo,

    // ── 内容能力（#278 自门面迁入）────────────────────────────────

    /** 歌手搜索（原 searchNeteaseArtists；cloudsearch weapi 被风控，走旧明文接口）。 */
    async searchArtists(keyword: string, limit: number): Promise<Artist[]> {
      const cacheKey = `search_artists_${keyword}_${limit}`;
      const cached = contentCache.get<Artist[]>(cacheKey);
      if (cached && Array.isArray(cached)) return cached;
      try {
        // 注:cloudsearch weapi 已被网易云风控(code=50000005,无 cookie 必现),
        // 直接走旧接口(已做 https 头像修复);后续若接入 cookie 机制可恢复 weapi 优先
        const data = await plaintextGetJson<any>(
          `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=100&limit=${limit}`
        );
        const rawArtists: any[] = data?.result?.artists || [];
        const artists = rawArtists.map(mapArtist);
        contentCache.set(cacheKey, artists, SEARCH_TTL_MS);
        return artists;
      } catch (error) {
        console.error('[neteaseDirect] 搜索歌手失败:', error);
        return [];
      }
    },

    /** 榜单（热歌榜/新歌榜）；返回前 fillLyrics。 */
    async getToplists(): Promise<ToplistGroup[]> {
      const cacheKey = 'netease_toplists';
      const cached = contentCache.get<ToplistGroup[]>(cacheKey);
      if (cached) return cached;
      const groups = await Promise.all(
        NETEASE_TOPLISTS.map(async (t) => ({
          id: `netease:${t.sourceId}`,
          name: t.name,
          songs: await fetchToplistSongs(t.sourceId),
        }))
      );
      for (const g of groups) {
        await fillLyrics(g.songs, contentCache);
      }
      if (groups.some((g) => g.songs.length > 0)) {
        contentCache.set(cacheKey, groups, TOPLIST_TTL_MS);
      }
      return groups;
    },

    /** 每日推荐歌曲（原 getRecommendedSongs）；返回前 fillLyrics。 */
    async getRecommendedSongs(limit: number): Promise<Song[]> {
      // cacheKey 必须包含 limit：接口按 limit 返回不同数量的歌
      const cacheKey = `personalized_newsong_${limit}`;
      const cached = contentCache.get<Song[]>(cacheKey);
      if (cached) return cached;
      const data = await plaintextGetJson<any>(`https://music.163.com/api/personalized/newsong?limit=${limit}`);
      const result: any[] = data?.result || [];
      const songs: Song[] = result.map((s: any) => ({
        id: String(s.id),
        name: s.name || '',
        artist: (s.artists || []).map((a: any) => a.name).join(' / ') || s.song?.artists?.[0]?.name || '',
        album: s.album?.name || s.song?.album?.name || '',
        url: '',
        cover: (s.album?.picUrl || s.picUrl || s.song?.album?.picUrl || '').replace(/^http:/, 'https:'),
        lrc: '',
        duration: s.duration ? Math.floor(s.duration / 1000) : s.song?.duration ? Math.floor(s.song.duration / 1000) : 0,
        sourceType: 'netease' as const,
      }));
      await fillLyrics(songs, contentCache);
      contentCache.set(cacheKey, songs, RECOMMENDED_TTL_MS);
      return songs;
    },

    /** 推荐歌单（原 getRecommendedPlaylists）。 */
    async getRecommendedPlaylists(limit: number): Promise<DiscoverPlaylist[]> {
      const cacheKey = `personalized_playlist_${limit}`;
      const cached = contentCache.get<DiscoverPlaylist[]>(cacheKey);
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
          contentCache.set(cacheKey, playlists, RECOMMENDED_TTL_MS);
          return playlists;
        }
        throw new Error(`weapi 返回异常 (code=${data?.code})`);
      } catch (error) {
        console.error('[neteaseDirect] getRecommendedPlaylists weapi 失败,回退旧接口:', error);
      }

      const data = await plaintextGetJson<any>(`https://music.163.com/api/personalized/playlist?limit=${limit}`);
      if (!data?.result) return [];
      const playlists = mapResult(data.result);
      contentCache.set(cacheKey, playlists, RECOMMENDED_TTL_MS);
      return playlists;
    },

    /** 新碟上架（weapi area 分类真实生效，失败回退旧接口）。 */
    async getNewAlbums(area: string, offset: number, limit: number): Promise<Album[]> {
      // key 必须含 offset/limit：分页参数不同返回不同数据，固定 key 会串页
      const cacheKey = `album_new_${area}_${offset}_${limit}`;
      const cached = contentCache.get<Album[]>(cacheKey);
      if (cached) return cached;
      try {
        const data = await weapiRequest<any>('/album/new', { area, offset, limit, total: true });
        if (data.code !== 200 || !data.albums) {
          throw new Error(`获取新碟失败 (area=${area})`);
        }
        const albums: Album[] = (data.albums as any[]).map(normalizeNeteaseAlbum);
        contentCache.set(cacheKey, albums, ALBUMS_TTL_MS);
        return albums;
      } catch (error) {
        console.error(`[neteaseDirect] getNewAlbums weapi 失败,回退旧接口 (area=${area}):`, error);
        try {
          const data = await plaintextGetJson<any>(`https://music.163.com/api/album/new?area=${area}&offset=${offset}&limit=${limit}`);
          if (!data?.albums) return [];
          const albums: Album[] = (data.albums as any[]).map(normalizeNeteaseAlbum);
          contentCache.set(cacheKey, albums, ALBUMS_TTL_MS);
          return albums;
        } catch (error2) {
          console.error('[neteaseDirect] getNewAlbums 失败(旧接口):', error2);
          return [];
        }
      }
    },

    /** 专辑详情 + 专辑歌曲；返回前补播放 URL（点开即播）与 fillLyrics。 */
    async getAlbumDetail(albumId: string): Promise<{ album: Album; songs: Song[] } | null> {
      const cacheKey = `album_detail_${albumId}`;
      const cached = contentCache.get<{ album: Album; songs: Song[] }>(cacheKey);
      if (cached) return cached;
      let album: Album;
      let songs: Song[];
      try {
        const data = await weapiRequest<any>(`/v1/album/${albumId}`, {});
        if (data.code !== 200 || !data.album) {
          throw new Error(`获取专辑详情失败 (albumId=${albumId})`);
        }
        album = normalizeNeteaseAlbum(data.album);
        // 专辑歌曲字段与歌单同构(ar/al/dt),复用同一映射
        songs = (data.songs || []).map(mapTrack);
      } catch (error) {
        console.error(`[neteaseDirect] getAlbumDetail weapi 失败 (albumId=${albumId}):`, error);
        return null;
      }
      await this.resolvePlayableUrls!(songs);
      await fillLyrics(songs, contentCache);
      const result = { album, songs };
      // 空结果不缓存,避免瞬时故障 10 分钟内无法自愈
      if (songs.length > 0) contentCache.set(cacheKey, result, PAGE_TTL_MS);
      return result;
    },

    /** 歌手分类列表（原 getNeteaseArtists，initial 固定 -1 与双端调用点一致）。 */
    async getArtists(cat: number, offset: number, limit: number): Promise<{ artists: Artist[]; total: number; more: boolean }> {
      const initial = -1;
      const mapped = NETEASE_CAT_MAP[cat];
      if (mapped || cat === 0) {
        // weapi 直连(带头像、结构化、可分页),失败时按原路径兜底
        const res = await fetchArtistsByWeapi(mapped?.type ?? 0, mapped?.area ?? -1, offset, limit, initial, contentCache);
        if (res.ok) return res;
        if (cat === 0) return fetchArtistsByApi(offset, limit, initial, contentCache);
      }
      return fetchArtistsByHtml(cat, contentCache);
    },

    /** 歌手详情合并（hotSongs + albums，一次调用渲染歌手页首屏）。 */
    async getArtistDetail(artistId: string): Promise<{ artist: Artist | null; hotSongs: Song[]; albums: Album[] }> {
      const [artist, songsRes, albumsRes] = await Promise.all([
        fetchArtistInfo(artistId),
        this.getArtistSongs!(artistId, 0, 50, 'hot'),
        this.getArtistAlbums!(artistId, 0, 30),
      ]);
      return { artist, hotSongs: songsRes.songs, albums: albumsRes.albums };
    },

    /** 歌手歌曲（分页；order: hot|time；weapi 失败回退旧接口）；返回前 fillLyrics。 */
    async getArtistSongs(artistId: string, offset: number, limit: number, order: string = 'hot'): Promise<{ songs: Song[]; total: number }> {
      const cacheKey = `artist_songs_${artistId}_${offset}_${limit}_${order}`;
      const cached = contentCache.get<{ songs: Song[]; total: number }>(cacheKey);
      if (cached) return cached;
      let songs: Song[] = [];
      let total = 0;
      try {
        const data = await weapiRequest<any>('/v1/artist/songs', { id: Number(artistId), private_cloud: 'true', work_type: 1, order, offset, limit });
        if (data.code !== 200) {
          throw new Error(`获取歌手歌曲失败 (artistId=${artistId})`);
        }
        songs = (data.songs || []).map(mapTrack);
        total = data.total || 0;
      } catch (error) {
        console.error(`[neteaseDirect] 获取歌手歌曲失败(weapi),回退旧接口 (artistId=${artistId}):`, error);
        try {
          const data = await plaintextGetJson<any>(`https://music.163.com/api/v1/artist/songs?id=${artistId}&offset=${offset}&limit=${limit}&order=${order}`);
          songs = (data.songs || []).map(mapTrack);
          total = data.total || 0;
        } catch (error2) {
          console.error('[neteaseDirect] 获取歌手歌曲失败(旧接口):', error2);
          return { songs: [], total: 0 };
        }
      }
      await fillLyrics(songs, contentCache);
      const result = { songs, total };
      contentCache.set(cacheKey, result, SEARCH_TTL_MS);
      return result;
    },

    /** 歌手专辑（分页；#278 保留：桌面歌手页专辑年表需无限滚动）。 */
    async getArtistAlbums(artistId: string, offset: number, limit: number): Promise<{ albums: Album[]; total: number; more: boolean }> {
      const cacheKey = `artist_albums_${artistId}_${offset}_${limit}`;
      const cached = contentCache.get<{ albums: Album[]; total: number; more: boolean }>(cacheKey);
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
        contentCache.set(cacheKey, result, PAGE_TTL_MS);
        return result;
      } catch (error) {
        console.error(`[neteaseDirect] getArtistAlbums 失败 (artistId=${artistId}):`, error);
        return { albums: [], total: 0, more: false };
      }
    },

    /** 歌单列表（明文 /api/playlist/list，cat + order + 分页）。 */
    async getPlaylists(cat: string, order: string, offset: number, limit: number): Promise<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }> {
      const cacheKey = `playlistList_${cat}_${order}_${offset}_${limit}`;
      const cached = contentCache.get<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }>(cacheKey);
      if (cached) return cached;
      try {
        const data = await plaintextGetJson<any>(
          `https://music.163.com/api/playlist/list?cat=${encodeURIComponent(cat)}&order=${order}&offset=${offset}&limit=${limit}`
        );
        const playlists: DiscoverPlaylist[] = (data.playlists || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          coverImgUrl: p.coverImgUrl || '',
          playCount: p.playCount || 0,
          trackCount: p.trackCount || 0,
          creator: { nickname: p.creator?.nickname || '' },
          tags: (p.tags || []).map((t: any) => (typeof t === 'string' ? t : t.name || '')),
          description: p.description || '',
        }));
        const result = { playlists, total: data.total || 0, more: data.more || false };
        contentCache.set(cacheKey, result, PLAYLIST_TTL_MS);
        return result;
      } catch (error) {
        console.error('[neteaseDirect] getPlaylists 失败:', error);
        return { playlists: [], total: 0, more: false };
      }
    },

    /** 歌单详情（weapi 失败回退旧接口）。 */
    async getPlaylistDetail(id: number): Promise<DiscoverPlaylist | null> {
      const cacheKey = `playlistDetail_${id}`;
      const cached = contentCache.get<DiscoverPlaylist>(cacheKey);
      if (cached) return cached;
      let playlistData: any = null;
      try {
        const data = await weapiRequest<any>('/v6/playlist/detail', { id, n: 100000, s: 8 });
        if (data.code !== 200 || !data.playlist) {
          throw new Error(`获取网易云歌单详情失败 (id=${id})`);
        }
        playlistData = data.playlist;
      } catch (error) {
        console.error('[neteaseDirect] getPlaylistDetail weapi 失败,回退旧接口:', error);
        try {
          playlistData = await fetchNeteasePlaylistLegacy(id);
        } catch (error2) {
          console.error('[neteaseDirect] getPlaylistDetail 失败(旧接口):', error2);
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
        tags: (playlistData.tags || []).map((t: any) => (typeof t === 'string' ? t : t.name || '')),
        description: playlistData.description || '',
      };
      contentCache.set(cacheKey, playlist, PLAYLIST_TTL_MS);
      return playlist;
    },

    /**
     * 歌单歌曲（分页 + 全量合一）：offset/limit 分页取（详情页滚动加载），
     * limit <= 0 = 全量（导入/播放全部，按 1000 id/批并行取详情）。
     * 详情与播放地址互不依赖，同批并行请求省一个 RTT；返回前 fillLyrics。
     */
    async getPlaylistSongs(id: number, offset: number = 0, limit: number = 50): Promise<{ songs: Song[]; total: number }> {
      const cacheKey = `netease_playlist_songs_${id}_${offset}_${limit}`;
      const cached = contentCache.get<{ songs: Song[]; total: number }>(cacheKey);
      if (cached) return cached;

      const trackIds = await fetchNeteasePlaylistTrackIds(id);
      const range = limit > 0 ? trackIds.slice(offset, offset + limit) : trackIds.slice(offset);
      const songs: Song[] = [];
      try {
        // 每批最多 1000 个 id,并行取详情 + 播放地址
        for (let i = 0; i < range.length; i += 1000) {
          const batch = range.slice(i, i + 1000);
          const [detailRes, urlMap] = await Promise.all([
            weapiRequest<{ code: number; songs?: any[] }>('/v3/song/detail', { c: JSON.stringify(batch.map((bid) => ({ id: bid }))) }),
            fetchNeteaseSongUrlMap(batch),
          ]);
          for (const t of detailRes.songs || []) {
            const song = mapTrack(t);
            const u = urlMap.get(Number(song.id));
            if (u) song.url = u;
            songs.push(song);
          }
        }
      } catch (error) {
        console.error(`[neteaseDirect] getPlaylistSongs weapi 失败,回退旧接口 (id=${id}):`, error);
        try {
          const p = await fetchNeteasePlaylistLegacy(id);
          const legacyTracks: any[] = p?.tracks || [];
          const slice = limit > 0 ? legacyTracks.slice(offset, offset + limit) : legacyTracks.slice(offset);
          songs.length = 0;
          songs.push(...slice.map(mapTrack));
        } catch (error2) {
          console.error(`[neteaseDirect] getPlaylistSongs 失败(旧接口) (id=${id}):`, error2);
        }
      }

      await fillLyrics(songs, contentCache);

      const result = { songs, total: trackIds.length };
      // 空结果不缓存,避免瞬时故障导致 10 分钟内无法自愈
      if (songs.length > 0) contentCache.set(cacheKey, result, PAGE_TTL_MS);
      return result;
    },

    /** 批量补齐可播放 URL（原 resolveNeteaseSongUrls：weapi by-ID 批量直连）。 */
    async resolvePlayableUrls(songs: Song[]): Promise<void> {
      const ids = songs.map((s) => Number(s.id)).filter((id) => Number.isFinite(id) && id > 0);
      const urlMap = await fetchNeteaseSongUrlMap(ids);
      for (const song of songs) {
        const u = urlMap.get(Number(song.id));
        if (u) song.url = u;
      }
    },
  };
}

export const neteaseDirectClient: DirectSourceClient = createNeteaseDirectClient();
