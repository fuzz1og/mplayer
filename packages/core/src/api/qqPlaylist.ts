import type { Song } from '../types/index.js';
import { request } from './transport.js';
import { mapTrack, musicuPost } from './qqDirect.js';
import { cacheManager } from './memoryCacheManager.js';

/**
 * QQ 音乐歌单原生模块（#280，链接导入直连化）。
 *
 * 调研依据：`docs/research/qq-playlist-api-research.md`（分支 research/qq-playlist-api，
 * 2026-08-28 当日实测）。匿名直连方案：
 * - 歌单详情：`POST u.y.qq.com/cgi-bin/musicu.fcg` + module `music.srfDissInfo.DissInfo`
 *   / `CgiGetDiss`——无登录/无 cookie/无签名/无 Referer 校验，comm 用最小头
 *   `{ct:24, cv:0}`（对 QIMEI 不敏感，本模块不依赖 QIMEI 机件）。
 *   **需签名的同族接口（srfDissDetail.SIGetDissInfo / playlist.PlaylistInfo /
 *   playlist.PlaylistSonglistPage）实测 500003，禁用**。
 * - 分页：`song_begin`/`song_num` + `hasmore` 兜底翻页；实测大 `song_num` 一枪全量，
 *   单页上限由 QQ_PLAYLIST_MAX_SONGS 封顶（超大歌单截断并告警）。
 * - 边界（外层 code 恒 0，必须看内层信号）：歌单不存在/已删除 = `data.code=-100006`；
 *   隐私歌单 = `dirinfo.title` 含「隐私」且 `songnum=0`——都映射为明确错误。
 * - 短链（`c6.y.qq.com/base/fcgi-bin/u?__=xxx`）：默认传输自动跟随重定向，落地地址取
 *   `finalUrl`；mock 传输不跟随时退回 `Location` 头。落地页按 URL 结构提取 disstid（见下方
 *   「QQ 链接识别」小节），落地为 `playsong.html` 歌曲链接则给出明确错误。
 * - 曲目 `url` 留空：播放时由 resolvePlayableSongRouted 路由解析，导入不逐首 GetVkey。
 * - 缓存照网易歌单模式（10 分钟，空结果不缓存）。
 *
 * 与 qqDirect 的关系：musicu POST 基建与新版字段映射（mid/title/singer/album.mid/
 * interval）复用——musicuPost/mapTrack/buildLyricUrl 直接 import 自 qqDirect（#279 落地后已收敛为单一实现）。
 */

const DISS_MODULE = 'music.srfDissInfo.DissInfo';
const DISS_METHOD = 'CgiGetDiss';

const PLAYLIST_TTL_MS = 10 * 60 * 1000;

/** 超大歌单导入上限（调研建议 1000 首；超出截断并 console.warn 提示）。 */
export const QQ_PLAYLIST_MAX_SONGS = 1000;

/** 短链重定向解析最多跟随的跳数（实测链长 ≤3：短链 → H5/落地页）。 */
const MAX_SHORT_LINK_HOPS = 3;

// ── QQ 链接识别：按 URL 结构判定，不对整串文本跑正则 ──────────────
//
// 分享链接是用户粘贴的不受信文本：对整串跑「字面量 + 无界通配」正则，在「重复
// `y.qq.com` 前缀」这类输入上是 O(n²)（CodeQL js/polynomial-redos #17/#18），
// 且子串判定会把 `y.qq.com.evil.com` 也当成 QQ 域。统一改走 `new URL` 的
// hostname / pathname / searchParams（RN 侧 URL 实现已由 core 其它模块在用），
// 顺带把 host 判定收紧成标签级比对。

/** QQ 音乐主域（其子域同属：i.y.qq.com / c6.y.qq.com / u.y.qq.com…）。 */
const QQ_HOST = 'y.qq.com';

/** host 是否为 `suffix` 本身或其后代（标签级比对，非子串判定）。 */
function isHostWithin(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const base = suffix.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}

/** 分隔链接与说明文字的字符：空白、引号、括号与中英文标点（分享文案会把链接包在这些字符之间）。 */
const URL_TOKEN_BOUNDARY_RE = /[\s"'`<>()（）【】《》「」『』，。、；：！？…·,;]/;

/** 候选 token → http(s) URL（缺协议头补 `https://`——用户常直接粘 `y.qq.com/...`）；解析失败返回 null。 */
function tryParseHttpUrl(token: string): URL | null {
  const text = token.trim();
  if (!text) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return /^https?:$/.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 含 QQ 域的分享文本 → URL。
 *
 * 分享文案常把链接夹在说明文字里（旧的不锚定正则正是靠这点容忍度工作的），
 * 所以先定位 `y.qq.com`，再向两侧扩到 token 边界，最后交给 URL 解析：
 * 容忍度不变，但 host / pathname / query 的判定从此基于结构而非子串。
 */
function parseQqUrl(raw: string): URL | null {
  const text = (raw || '').trim();
  if (!text) return null;
  const hostAt = text.toLowerCase().indexOf(QQ_HOST);
  if (hostAt === -1) return null;

  let start = hostAt;
  while (start > 0 && !URL_TOKEN_BOUNDARY_RE.test(text[start - 1]!)) start -= 1;
  let end = hostAt + QQ_HOST.length;
  while (end < text.length && !URL_TOKEN_BOUNDARY_RE.test(text[end]!)) end += 1;
  return tryParseHttpUrl(text.slice(start, end));
}

/** web 歌单页路径：`/n/ryqq{,_v2}/playlist/{id}`（兼容旧 `/n/yqq/...`）。 */
const QQ_WEB_PLAYLIST_PATH_RE = /^(?:\/n)?\/(?:ryqq|yqq)(?:_v2)?\/playlist\/(\d+)$/;

/** H5 分享页文件名：`taoge.html` / `playlist.html`（`id` 在 query 里，可不在首位）。 */
const QQ_H5_PLAYLIST_FILES = new Set(['taoge.html', 'playlist.html']);

/**
 * 从 QQ 音乐 URL 提取歌单 disstid（纯函数，不发请求）。
 * 覆盖 web 歌单页直链（`/n/ryqq{,_v2}/playlist/{id}`）与 H5 分享页
 * （`taoge.html?id=` / `playlist.html?id=`）；短链与歌曲链接返回 null。
 * parsePlaylistUrl 的 QQ 直链分支与本模块共用此函数，避免双份判定漂移。
 */
export function extractQqPlaylistIdFromUrl(url: string): number | null {
  const parsed = parseQqUrl(url);
  if (!parsed || !isHostWithin(parsed.hostname, QQ_HOST)) return null;

  const webMatch = QQ_WEB_PLAYLIST_PATH_RE.exec(parsed.pathname);
  if (webMatch) return Number(webMatch[1]) || null;

  const fileName = (parsed.pathname.split('/').pop() || '').toLowerCase();
  if (QQ_H5_PLAYLIST_FILES.has(fileName)) {
    const id = parsed.searchParams.get('id');
    return id && /^\d+$/.test(id) ? Number(id) : null;
  }
  return null;
}

/** 是否为歌曲分享页链接（playsong.html，非歌单）。 */
export function isQqSongLink(url: string): boolean {
  const parsed = parseQqUrl(url);
  if (!parsed || !isHostWithin(parsed.hostname, QQ_HOST)) return false;
  if (!/(?:^|\/)playsong\.html$/i.test(parsed.pathname)) return false;
  return !!(parsed.searchParams.get('songmid') || parsed.searchParams.get('songid'));
}

/** 是否为 QQ App 分享短链（`c6.y.qq.com/base/fcgi-bin/u?__=xxx`，需跟随 302 解析）。 */
export function isQqShortLink(url: string): boolean {
  const parsed = parseQqUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host !== QQ_HOST && !/^c\d*\.y\.qq\.com$/.test(host)) return false;
  return parsed.searchParams.get('__') !== null;
}

/** 歌单链接解析失败统一错误文案。 */
function unknownLinkError(url: string): Error {
  return new Error(isQqSongLink(url) ? '这是 QQ 音乐歌曲链接，请分享歌单链接' : '无法识别的 QQ 歌单链接');
}

/**
 * 解析 QQ 歌单链接为 disstid（#280）。
 * - 直链（ryqq playlist / taoge.html / playlist.html）：正则直接提取；
 * - 短链（`__=`）：经 transport GET（默认实现自动跟随重定向）取落地地址，
 *   不跟随的实现退回 302 Location 头；对落地地址递归解析（≤3 跳）；
 * - 落地为歌曲链接（playsong.html?songmid=）→ 明确报「歌曲链接」。
 * 无法解析抛错（调用方把 message 直接透给用户）。
 */
export async function resolveQqPlaylistDisstid(url: string): Promise<number> {
  const trimmed = (url || '').trim();
  if (!trimmed) throw new Error('请输入 QQ 歌单链接');

  let current = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  for (let hop = 0; hop < MAX_SHORT_LINK_HOPS; hop += 1) {
    const directId = extractQqPlaylistIdFromUrl(current);
    if (directId !== null) return directId;

    // 短链才继续跟跳；其余形态（含歌曲链接）按无法识别/歌曲链接报错。
    if (!isQqShortLink(current)) throw unknownLinkError(current);

    // maxRedirects:0：桌面 axios 默认跟随 302，跟完后既无 location 头也（Node 上）
    // 无 responseURL，落地地址就拿不到了；显式不跟随，302 + Location 才可见。
    // RN XHR 忽略此字段原生跟随，走 responseURL 兜底。
    const res = await request({ method: 'GET', url: current, timeoutMs: 10000, maxRedirects: 0 });
    if (res.status >= 400) throw new Error(`QQ 短链已失效（HTTP ${res.status}）`);
    const location = res.headers?.location;
    const locationStr = Array.isArray(location) ? location[0] : location;
    const landed =
      res.finalUrl && res.finalUrl !== current
        ? res.finalUrl
        : typeof locationStr === 'string' && locationStr
          ? new URL(locationStr, current).toString()
          : '';
    if (!landed) throw new Error('QQ 短链解析失败（未获得跳转目标）');
    current = landed;
  }
  throw new Error('QQ 短链重定向次数过多');
}

/** 单次 CgiGetDiss 请求 → 该页 songlist（已映射）+ hasmore + dirinfo。 */
async function fetchDissPage(disstid: number, songBegin: number, songNum: number) {
  const data = await musicuPost({
    // 最小 comm 头：歌单 module 对 QIMEI/登录态不敏感（调研实测）
    comm: { ct: 24, cv: 0 },
    req_0: {
      module: DISS_MODULE,
      method: DISS_METHOD,
      param: {
        disstid,
        dirid: 0,
        song_begin: songBegin,
        song_num: songNum,
        orderlist: true,
      },
    },
  });
  const moduleRes = data?.req_0;
  if (moduleRes?.code !== 0) {
    throw new Error(`QQ 歌单接口 code=${String(moduleRes?.code ?? '无响应')}`);
  }
  const d = moduleRes.data || {};
  // 内层信号：外层 code 恒 0，不存在/已删除走 data.code=-100006（调研实测）
  if (d.code === -100006) {
    throw new Error('QQ 歌单不存在或已被删除');
  }
  if (d.code && d.code !== 0) {
    throw new Error(`QQ 歌单接口错误 code=${d.code}`);
  }
  const dirinfo = d.dirinfo || {};
  // 隐私歌单：title 带「隐私」且 songnum=0（服务端不报错，必须显式识别）
  if (Number(dirinfo.songnum) === 0 && typeof dirinfo.title === 'string' && dirinfo.title.includes('隐私')) {
    throw new Error('该 QQ 歌单被主人设为隐私，无法导入');
  }
  const list = Array.isArray(d.songlist) ? d.songlist : [];
  return {
    songs: list.map(mapTrack).filter((s: Song) => s.id),
    hasmore: d.hasmore === 1,
    totalSongs: Number(dirinfo.songnum) || Number(d.total_song_num) || 0,
  };
}

/** 按 disstid 匿名拉全量曲目（song_num 大值一枪全量 + hasmore 兜底翻页，上限封顶）。 */
async function fetchDissSongs(disstid: number): Promise<Song[]> {
  const songs: Song[] = [];
  let totalSongs = 0;
  while (songs.length < QQ_PLAYLIST_MAX_SONGS) {
    const page = await fetchDissPage(disstid, songs.length, QQ_PLAYLIST_MAX_SONGS - songs.length);
    totalSongs = page.totalSongs || totalSongs;
    songs.push(...page.songs);
    // hasmore 兜底翻页（服务端单页截断时续拉）；空页防死循环
    if (!page.hasmore || page.songs.length === 0) break;
  }
  if (totalSongs > songs.length && songs.length >= QQ_PLAYLIST_MAX_SONGS) {
    console.warn(`[qqPlaylist] 歌单 ${disstid} 共 ${totalSongs} 首，超出导入上限 ${QQ_PLAYLIST_MAX_SONGS}，已截断`);
  }
  return songs;
}

/**
 * QQ 歌单全量曲目（musicApi 门面对位方法，与旧 getNeteasePlaylistSongs 对称）。
 * 入参兼容三种形态：disstid（number）/ 数字串 / 歌单链接（直链或 `__=` 短链）。
 * 缓存 key `qq_playlist_songs_${disstid}`、TTL 10 分钟（空结果不缓存）；
 * 错误（不存在/隐私/歌曲链接）上抛由调用方透出。
 */
export async function getQqPlaylistSongs(source: string | number): Promise<Song[]> {
  const disstid =
    typeof source === 'number'
      ? source
      : /^\d+$/.test(source.trim())
        ? Number(source.trim())
        : await resolveQqPlaylistDisstid(source);
  if (!Number.isFinite(disstid) || disstid <= 0) {
    throw new Error('无效的 QQ 歌单 ID');
  }

  const cacheKey = `qq_playlist_songs_${disstid}`;
  const cached = cacheManager.get<Song[]>(cacheKey);
  if (cached) return cached;

  const songs = await fetchDissSongs(disstid);
  if (songs.length > 0) {
    cacheManager.set(cacheKey, songs, PLAYLIST_TTL_MS);
  }
  return songs;
}

/** 测试用：清空本模块缓存。 */
export function resetQqPlaylistForTests(): void {
  cacheManager.clearByPrefix('qq_playlist_songs_');
}
