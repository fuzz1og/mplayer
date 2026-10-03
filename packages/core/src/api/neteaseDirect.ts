import type { Album, AlbumDetail, Artist, DiscoverPlaylist, Song } from '../types/index.js';
import type { ArtistAlbumsPage, ContentCache, DirectSourceClient, ToplistDetail, ToplistGroup } from '../shared/sourceRouter.js';
import type { UrlInfo } from '../shared/playability.js';
import { normalizePublishTime } from '../utils/publishTime.js';
import { request, bodyToText, cappedRequestTimeout, type TransportCallOptions } from './transport.js';
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
 * **歌词按需直取（#409，取代 #242 的列表内联）**：网易直连接口天然不带歌词字段
 * （cloudsearch 实测无 lrc）。原实现在**每个内容方法返回前**对列表中每一首歌各发一次
 * 取词请求（`fillLyrics`，并发 8、窗口 10s）——代价是打开发现页/推荐页一次就打出
 * 数百次上游请求，而界面只用得到歌名/歌手/封面。现改为**播放期按 songId 直取**：
 * `getNeteaseLyrics(songId)`，key `lyric_id_${songId}`、TTL 1 天、命中零请求、空词也缓存。
 * 列表结果里的 `Song.lrc` 因此**恒为空**，消费端不得再假设它带词（双端决策见 core
 * `shared/songLyrics.ts`）。
 *
 * `resolveUrlInfo` 提供权威完整时长验证字段（url/br/size/playTime/fee/payed）。
 */

const CLOUDSEARCH_URL = 'https://music.163.com/api/cloudsearch/pc';
const PAGE_SIZE = 30;
/** cloudsearch/pc 的 `limit` 硬上限：上游对 `limit>100` 直接返回 `code=400`。 */
const CLOUDSEARCH_MAX_LIMIT = 100;
/** cloudsearch/pc 的 `type`（社区逆向类型表：1 单曲 / 100 歌手 / 1000 歌单）。 */
const CLOUDSEARCH_TYPE_SONG = 1;
const CLOUDSEARCH_TYPE_ARTIST = 100;
const CLOUDSEARCH_TYPE_PLAYLIST = 1000;
const LYRIC_URL = 'https://music.163.com/api/song/lyric';

// ── 缓存 TTL（对齐门面旧语义）──────────────────────────────────────
const TOPLIST_TTL_MS = 24 * 60 * 60 * 1000;      // 榜单 1 天（原 hotlist 缓存）
const LYRIC_TTL_MS = 24 * 60 * 60 * 1000;        // 歌词 1 天（原 getLyricsBySongId）
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;        // 搜索/歌手 6h（原 search 缓存）
const PLAYLIST_TTL_MS = 5 * 60 * 1000;           // 歌单列表/详情 5min
const PAGE_TTL_MS = 10 * 60 * 1000;              // 歌单歌曲/专辑详情/歌手专辑 10min
const ALBUMS_TTL_MS = 60 * 60 * 1000;            // 新碟 1h
const RECOMMENDED_TTL_MS = 15 * 60 * 1000;       // 推荐 15min

// 歌手专辑页大小自控上限（#417 实测：limit ≥ 2000 → 上游 code=-460）
const ALBUM_PAGE_MAX = 1000;

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

/**
 * 明文 GET（transport 接缝出网）→ 文本。
 *
 * `options.signal` 一路透传到 transport：排队中的请求可从闸门队列摘除、在飞的请求
 * 真的被 abort（#408 协作式取消）。歌词预取（#429）靠它做到「取消后不再出网」。
 */
async function plaintextGetText(url: string, options?: TransportCallOptions): Promise<string> {
  const res = await request({
    method: 'GET',
    url,
    headers: PLAINTEXT_HEADERS,
    timeoutMs: 30000,
    signal: options?.signal,
  });
  if (res.status >= 400) {
    throw new Error(`网易明文接口 HTTP ${res.status}: ${url}`);
  }
  return bodyToText(res.body);
}

/** 明文 GET → JSON。 */
async function plaintextGetJson<T>(url: string, options?: TransportCallOptions): Promise<T> {
  const text = await plaintextGetText(url, options);
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

/**
 * 网易云专辑字段统一映射（weapi artist 单对象 / 旧接口 artists 数组，兼容两种形状）。
 *
 * #407：原先只取 5 个字段，上游响应里的公司/简介/子类型/曲目数全部被丢弃。
 * 字段名按 2026-09-27 实测（`/api/v1/album/267786859` 与 `/api/artist/albums/5196`
 * 的 album 对象同形状）：company / description / subType / size / tags / publishTime。
 * 元数据一律「有则渲染、无则省略」——取不到就不给字段，不做占位。
 */
function normalizeNeteaseAlbum(raw: any): Album {
  const rawArtist = raw.artists || raw.artist || [];
  const artistList = Array.isArray(rawArtist) ? rawArtist : [rawArtist];
  const artist = artistList.map((a: any) => a?.name || '').filter(Boolean).join(' / ') || '';
  const primaryArtistId = artistList.find((a: any) => a?.id != null)?.id;
  const tags = typeof raw.tags === 'string' ? raw.tags : Array.isArray(raw.tags) ? raw.tags.filter(Boolean).join(' / ') : '';
  return {
    id: String(raw.id),
    name: raw.name || raw.album?.name || '',
    picUrl: raw.picUrl || raw.album?.picUrl || raw.coverImgUrl || '',
    artist,
    publishTime: normalizePublishTime(raw.publishTime ?? raw.publish_time),
    sourceType: 'netease',
    artistId: primaryArtistId != null ? String(primaryArtistId) : undefined,
    company: raw.company || undefined,
    description: raw.description || raw.briefDesc || undefined,
    genre: tags || undefined,
    language: raw.language || undefined,
    trackCount: typeof raw.size === 'number' ? raw.size : undefined,
    subType: raw.subType || undefined,
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

/**
 * 歌单搜索的同键在飞去重（#415 单飞）。与 `tier3Inflight` 同取向：底层 promise
 * **结算后才出表**，迟到的同键调用方仍能 join 同一条结果。
 *
 * 放在客户端（而不是各端 UI）是因为上游**只有一个**：桌面经 IPC 落在主进程的同一
 * 客户端实例、移动端在进程内。UI 侧的「切 tab 才发」管懒加载，这里管并发去重。
 */
const playlistSearchInflight = new Map<
  string,
  Promise<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }>
>();

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
async function fetchLyricBySongId(songId: string, options?: TransportCallOptions): Promise<string> {
  const data = await plaintextGetJson<{ lrc?: { lyric?: string } }>(
    `${LYRIC_URL}?id=${encodeURIComponent(songId)}&lv=1&kv=1&tv=-1`,
    options
  );
  return data.lrc?.lyric || '';
}

/**
 * 按 songId 取网易歌词（#409 取代 #242 的列表内联批量取词）。
 *
 * 语义与原地批量实现逐条保持一致，只是**调用时机从「列表返回前」改成「播放期按需」**：
 * - key `lyric_id_${songId}`、TTL 1 天；命中零请求；
 * - **空词也缓存**（值包 `{v}` 对象以区分「无缓存」与「确认无词」——纯音乐/无词歌
 *   不再反复请求；此为 #242 对 #246「空歌词不入库」的显式反转，继续沿用）；
 * - 拉取失败不缓存（保留重试机会）、失败返回空串（不上抛：歌词拿不到不该让播放失败）。
 *
 * `options.signal`（#429）：预取入队的取消语义——取消 = 这次不取，**失败语义不变**
 * （取消也走 catch 返回空串，调用方靠自己的 signal 区分「没取」与「取不到」）。
 */
export async function getNeteaseLyrics(
  songId: string,
  options?: TransportCallOptions
): Promise<string> {
  if (!songId) return '';
  const cacheKey = `lyric_id_${songId}`;
  const hit = cacheManager.get<{ v: string }>(cacheKey);
  if (hit) return hit.v;
  try {
    const lrc = await fetchLyricBySongId(songId, options);
    cacheManager.set(cacheKey, { v: lrc }, LYRIC_TTL_MS);
    return lrc;
  } catch {
    return '';
  }
}

/**
 * 明文 cloudsearch 单次搜索（#415 起单曲 `type=1` / 歌手 `type=100` / 歌单 `type=1000`
 * 共用同一条腿）：只负责「发请求 + 校验 code」，返回上游 `result`，字段映射留给调用方。
 *
 * 请求形态与头**逐字沿用**原 `neteaseSearchSongs`（不新增头、不加签名/加密）。
 * 非 200 的 `code` 一律抛错（`405/406` 风控、`400` 参数错误、`500` 上游异常）——
 * **绝不静默返回空数组**：那会把「被限流/出错」伪装成「没有结果」。
 */
async function cloudsearchSearch(
  keyword: string,
  type: number,
  limit: number,
  offset: number,
  opts?: TransportCallOptions,
): Promise<any> {
  const params = new URLSearchParams({
    s: keyword,
    type: String(type),
    limit: String(limit),
    offset: String(offset),
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
    timeoutMs: cappedRequestTimeout(8000, opts),
    signal: opts?.signal,
  });
  if (typeof res.body !== 'string') {
    throw new Error('cloudsearch 响应非文本');
  }
  const data = JSON.parse(res.body) as { code: number; message?: string; result?: any };
  if (data.code !== 200) {
    throw new Error(`cloudsearch code=${data.code} ${data.message || ''}`);
  }
  return data.result;
}

/** cloudsearch `limit` 钳制：非正数/非法值兜底 1，上限 {@link CLOUDSEARCH_MAX_LIMIT}（上游 `limit>100 → code=400`）。 */
function clampCloudsearchLimit(limit: number): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, CLOUDSEARCH_MAX_LIMIT);
}

/** cloudsearch `offset` 归一：负数/非法值按 0 处理（越界由上游 `playlistCount=0` 表达，core 不设上限）。 */
function normalizeCloudsearchOffset(offset: number | undefined): number {
  const n = Math.floor(Number(offset));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 明文 cloudsearch 搜索 → Song[]（不含歌词字段；播放期按 songId 直取，见 #409）。 */
async function neteaseSearchSongs(keyword: string, page = 1, opts?: TransportCallOptions): Promise<Song[]> {
  const result = await cloudsearchSearch(keyword, CLOUDSEARCH_TYPE_SONG, PAGE_SIZE, (page - 1) * PAGE_SIZE, opts);
  return ((result?.songs || []) as any[]).map(mapTrack);
}

/**
 * cloudsearch 原生歌单 → `DiscoverPlaylist`（#415：字段 1:1 可映射，不需要新类型）。
 * - 上游 `coverImgUrl` 实测为 `http://`：桌面 Electron 混合内容会被拦 → 统一转 https；
 * - `creator` 可能为 null、`playCount`/`trackCount` 可能缺失 → 兜底；
 * - `tags`：cloudsearch/pc 的歌单对象**没有该字段**（`officialTags` 是官方推荐位标签，
 *   语义不同，不当 tags 用）→ 补 `[]`。
 */
function mapPlaylist(p: any): DiscoverPlaylist {
  return {
    id: p.id,
    name: p.name || '',
    coverImgUrl: (p.coverImgUrl || '').replace(/^http:/, 'https:'),
    playCount: p.playCount || 0,
    trackCount: p.trackCount || 0,
    creator: { nickname: p.creator?.nickname || '' },
    tags: [],
    description: p.description || '',
  };
}

/** weapi 播放 URL 权威完整时长验证字段（T12 预检用）。无版权/VIP → null。 */
async function neteaseResolveUrlInfo(song: Song, opts?: TransportCallOptions): Promise<UrlInfo | null> {
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
  }>(
    '/song/enhance/player/url/v1',
    {
      ids: '[' + song.id + ']',
      level: 'standard',
      encodeType: 'mp3',
    },
    opts,
  );
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

/**
 * 歌手信息（明文 `/api/v1/artist/{id}`，getArtistDetail 用）。
 *
 * #417：原先用的 `/api/artist?id=` 实测 **code=404（死链，对照请求正常，非限流）**，
 * 于是 `getArtistDetail` 的 `artist` 恒为 null（hotSongs/albums 正常）。
 * 换成 `/api/v1/artist/{id}`：实测匿名 code=200，且 `albumSize` 是权威值
 * （专辑对象内嵌的 `artist.albumSize` 会偏小：陶喆实测 30 vs 31）。
 */
async function fetchArtistInfo(artistId: string): Promise<Artist | null> {
  try {
    const data = await plaintextGetJson<any>(`https://music.163.com/api/v1/artist/${artistId}`);
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
 * 测试可注入内存假缓存验证按需取词缓存语义（命中零请求/空词也缓存）。
 */
export function createNeteaseDirectClient(contentCache: ContentCache = defaultContentCache): DirectSourceClient {
  return {
    key: 'netease',

    /** 明文 cloudsearch 搜索（列表不带歌词，播放期按 songId 直取，见 #409）。
     *  `opts`（#556 评审 A1）：链尾搜索腿的墙钟与取消信号透传给 transport。 */
    async searchSongs(keyword: string, page = 1, opts?: TransportCallOptions): Promise<Song[]> {
      return neteaseSearchSongs(keyword, page, opts);
    },

    /** weapi 播放 URL；VIP/无版权返回空串 → 交给换元层 / 明确不可播。 */
    async resolvePlayableUrl(song: Song, opts?: TransportCallOptions): Promise<string> {
      const info = await neteaseResolveUrlInfo(song, opts);
      return info?.url || '';
    },

    resolveUrlInfo: neteaseResolveUrlInfo,

    // ── 内容能力（#278 自门面迁入）────────────────────────────────

    /**
     * 歌手搜索（#415 从 `GET /api/search/get/web?type=100` 迁到本条腿 `type=100`）。
     *
     * 迁移理由（两条一起解决）：
     * 1. 旧腿是调研里**唯一被实测封禁**的腿——无间隔连打时先 `code=500` 再全 type
     *    `code=405/406 操作频繁`、冷却量级 ≥10 分钟；`cloudsearch/pc` 同一时间窗内全程 200。
     * 2. 旧实现 catch 后**静默 `return []`**，「被限流」与「真没这个歌手」在 UI 上
     *    不可区分（都显示「未找到」）。迁到本条腿后与搜索/歌单共用同一份
     *    `code !== 200 → 抛错` 逻辑：失败抛错（双端本就有错误态分支），
     *    `code=200` + 空数组才是「真没这个歌手」。
     */
    async searchArtists(keyword: string, limit: number): Promise<Artist[]> {
      const kw = keyword.trim();
      const cacheKey = `search_artists_${kw}_${limit}`;
      const cached = contentCache.get<Artist[]>(cacheKey);
      if (cached && Array.isArray(cached)) return cached;
      const result = await cloudsearchSearch(kw, CLOUDSEARCH_TYPE_ARTIST, clampCloudsearchLimit(limit), 0);
      const artists = ((result?.artists || []) as any[]).map(mapArtist);
      // 空结果不缓存：失败绝不伪装成结果，且「真无命中」不占 6h（保留自愈）
      if (artists.length > 0) contentCache.set(cacheKey, artists, SEARCH_TTL_MS);
      return artists;
    },

    /**
     * 歌单搜索（#415）：与 `searchSongs` **同一条明文腿**（`cloudsearch/pc` `type=1000`），
     * 复用既有 transport 接缝与头，**不新增签名 / 不新增加密 / 不新增请求头**。
     *
     * 分页：该端点**不返回 `hasMore`** → `more = offset + limit < playlistCount` 推导；
     * `offset` 越界时上游返回 `code=200 + playlistCount=0` → `{ playlists: [], total: 0, more: false }`，
     * **视为到底，不是错误**（不抛错、不弹失败）。
     *
     * 边界：`limit` 内部钳制 ≤100（上游 `limit>100 → code=400`）；空关键词本地拒绝
     * （上游空 `s` 同样 `code=400`，本地拒绝省一次请求且错误语义可区分）。
     *
     * 缓存：key 含关键词 + limit + offset，TTL 6h（与搜索/歌手同档）；**空结果不缓存**。
     * 并发：同 key 单飞（见 `playlistSearchInflight`）。
     */
    async searchPlaylists(
      keyword: string,
      limit: number,
      offset = 0,
    ): Promise<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }> {
      const kw = keyword.trim();
      if (!kw) {
        throw new Error('歌单搜索需要非空关键词（上游空 s 为 code=400）');
      }
      const size = clampCloudsearchLimit(limit);
      const start = normalizeCloudsearchOffset(offset);
      const cacheKey = `search_playlists_${kw}_${size}_${start}`;
      const cached = contentCache.get<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }>(cacheKey);
      if (cached) return cached;

      const existing = playlistSearchInflight.get(cacheKey);
      if (existing) return existing;

      const run = async () => {
        const result = await cloudsearchSearch(kw, CLOUDSEARCH_TYPE_PLAYLIST, size, start);
        const playlists = ((result?.playlists || []) as any[]).map(mapPlaylist);
        const total = typeof result?.playlistCount === 'number' ? result.playlistCount : 0;
        const page = { playlists, total, more: start + size < total };
        // 空结果不缓存：瞬时故障与「越界到底」都不该占 6h（与 getPlaylistSongs 同取向）
        if (playlists.length > 0) contentCache.set(cacheKey, page, SEARCH_TTL_MS);
        return page;
      };

      const pending = run().finally(() => {
        playlistSearchInflight.delete(cacheKey);
      });
      playlistSearchInflight.set(cacheKey, pending);
      return pending;
    },

    /** 榜单（热歌榜/新歌榜）。 */
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
      if (groups.some((g) => g.songs.length > 0)) {
        contentCache.set(cacheKey, groups, TOPLIST_TTL_MS);
      }
      return groups;
    },

    /** 每日推荐歌曲（原 getRecommendedSongs）。 */
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

    /**
     * 专辑详情 + 专辑歌曲；返回前补播放 URL（点开即播）。
     *
     * #407：① 缓存键含源（`album_detail_netease_${id}`）——同一数字 id 在不同源语义不同；
     * ② weapi 失败补**明文兜底腿** `/api/v1/album/{id}`（实测匿名 code=200、同响应含
     *    company/description/subType/size/songs[].no）。注意**不是** `/api/album/{id}`：
     *    那条实测 code=-462（风控），照旧文档写会误判成签名问题。
     */
    async getAlbumDetail(albumId: string): Promise<AlbumDetail | null> {
      const cacheKey = `album_detail_netease_${albumId}`;
      const cached = contentCache.get<AlbumDetail>(cacheKey);
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
        console.error(`[neteaseDirect] getAlbumDetail weapi 失败,回退明文 (albumId=${albumId}):`, error);
        try {
          const data = await plaintextGetJson<any>(`https://music.163.com/api/v1/album/${albumId}`);
          if (data?.code !== 200 || !data.album) {
            throw new Error(`明文接口返回异常 (code=${data?.code})`);
          }
          album = normalizeNeteaseAlbum(data.album);
          songs = (data.songs || []).map(mapTrack);
        } catch (error2) {
          console.error(`[neteaseDirect] getAlbumDetail 失败(明文兜底) (albumId=${albumId}):`, error2);
          return null;
        }
      }
      await this.resolvePlayableUrls!(songs);
      const result: AlbumDetail = { album, songs };
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

    /**
     * 歌手信息（按 id，明文 /api/v1/artist/{id}；#417 歌手页首屏校正）。
     *
     * #496 补缓存：此前这是唯一**完全不过缓存**的内容能力——歌手页每次进入都会实打一次
     * 明文接口（入口带来的 name/pic 只够首帧，按 id 校正那一次是净请求）。TTL 与
     * `getArtistSongs` 同档（6h）：头像/名字不是分钟级会变的数据。
     */
    async getArtistInfo(artistId: string): Promise<Artist | null> {
      const cacheKey = `artist_info_${artistId}`;
      const cached = contentCache.get<Artist>(cacheKey);
      if (cached) return cached;
      const artist = await fetchArtistInfo(artistId);
      // 失败（null）不缓存：保留重试机会
      if (artist) contentCache.set(cacheKey, artist, SEARCH_TTL_MS);
      return artist;
    },

    /** 歌手详情合并（hotSongs + albums，一次调用渲染歌手页首屏）。 */
    async getArtistDetail(artistId: string): Promise<{ artist: Artist | null; hotSongs: Song[]; albums: Album[] }> {
      const [artist, songsRes, albumsRes] = await Promise.all([
        this.getArtistInfo!(artistId),
        this.getArtistSongs!(artistId, 0, 50, 'hot'),
        this.getArtistAlbums!(artistId, 0, 30),
      ]);
      return { artist, hotSongs: songsRes.songs, albums: albumsRes.albums };
    },

    /** 歌手歌曲（分页；order: hot|time；weapi 失败回退旧接口）。 */
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
      const result = { songs, total };
      contentCache.set(cacheKey, result, SEARCH_TTL_MS);
      return result;
    },

    /**
     * 歌手专辑（分页；#278 保留：桌面歌手页专辑年表需无限滚动）。
     *
     * #417：① **翻页只以 `more` 为准**——上游 `total` 在 `more=true` 时被 limit 截断，
     * 甚至直接缺失（实测 `/api/artist/albums/5196?limit=3` 返回体里没有 `total`），
     * 拿它渲染「共 N 张专辑」必然偏小；故 `more=true` → `total=null`（未知），
     * `more=false` → `offset + albums.length`（精确）。
     * ② 失败给 `ok:false`，页面据此给「加载失败，重试」而不是静默的「暂无专辑」；
     *    空专辑（合法）是 `ok:true + albums:[]`。
     * ③ `limit` 自控上限 1000（实测 ≥2000 → code=-460）；社区默认页大小 100。
     * ④ weapi 失败回退明文 `/api/artist/albums/{id}`（实测同数据、同 `more`、匿名可用）。
     */
    async getArtistAlbums(artistId: string, offset: number, limit: number): Promise<ArtistAlbumsPage> {
      const safeLimit = Math.min(Math.max(Math.trunc(limit) || 0, 1), ALBUM_PAGE_MAX);
      const cacheKey = `artist_albums_${artistId}_${offset}_${safeLimit}`;
      const cached = contentCache.get<ArtistAlbumsPage>(cacheKey);
      if (cached) return cached;

      const build = (rawAlbums: any[], more: boolean): ArtistAlbumsPage => {
        const albums = rawAlbums.map(normalizeNeteaseAlbum);
        return { albums, total: more ? null : offset + albums.length, more, ok: true };
      };
      const remember = (result: ArtistAlbumsPage): ArtistAlbumsPage => {
        if (result.albums.length > 0) contentCache.set(cacheKey, result, PAGE_TTL_MS);
        return result;
      };

      try {
        const data = await weapiRequest<any>(`/artist/albums/${artistId}`, { offset, limit: safeLimit, total: true });
        if (data.code !== 200) {
          throw new Error(`获取歌手专辑失败 (artistId=${artistId})`);
        }
        return remember(build(data.hotAlbums || data.albums || [], data.more !== false));
      } catch (error) {
        console.error(`[neteaseDirect] getArtistAlbums weapi 失败,回退明文 (artistId=${artistId}):`, error);
        try {
          const data = await plaintextGetJson<any>(
            `https://music.163.com/api/artist/albums/${artistId}?offset=${offset}&limit=${safeLimit}`
          );
          if (data?.code !== 200) {
            throw new Error(`明文接口返回异常 (code=${data?.code})`);
          }
          return remember(build(data.hotAlbums || data.albums || [], data.more === true));
        } catch (error2) {
          console.error(`[neteaseDirect] getArtistAlbums 失败(明文兜底) (artistId=${artistId}):`, error2);
          return { albums: [], total: null, more: false, ok: false };
        }
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
     * 榜单元数据（#465）：网易的榜单 id **本身就是歌单 id**（`fetchToplistSongs` 走的就是
     * `/v6/playlist/detail`），因此直接复用歌单详情能力——零新请求路径、零新解析、零新缓存键。
     * 只补一项 `updateTime: null`（榜单日更信息不在歌单详情里，且 Hero 不依赖它）。
     */
    async getToplistDetail(sourceId: number | string): Promise<ToplistDetail | null> {
      const playlist = await this.getPlaylistDetail!(Number(sourceId));
      if (!playlist) return null;
      return {
        id: sourceId,
        name: playlist.name,
        coverImgUrl: playlist.coverImgUrl,
        playCount: playlist.playCount,
        description: playlist.description ?? '',
        updateTime: null,
      };
    },

    /**
     * 歌单歌曲（分页 + 全量合一）：offset/limit 分页取（详情页滚动加载），
     * limit <= 0 = 全量（导入/播放全部，按 1000 id/批并行取详情）。
     * 详情与播放地址互不依赖，同批并行请求省一个 RTT。
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
