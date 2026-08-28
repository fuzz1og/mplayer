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
 *   `finalUrl`；mock 传输不跟随时退回 `Location` 头。落地页再走直链正则提取 disstid，
 *   落地为 `playsong.html` 歌曲链接则给出明确错误。
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

/** QQ App 分享短链（`c6.y.qq.com/base/fcgi-bin/u?__=xxx`）。 */
export const QQ_SHORT_LINK_RE = /(?:https?:\/\/)?(?:c\d+\.y\.qq\.com|y\.qq\.com)[^\s]*[?&]__=[^&\s]+/i;

/** web 歌单页直链：`y.qq.com/n/ryqq{,_v2}/playlist/{id}`（兼容旧 yqq 前缀）。 */
const QQ_WEB_PLAYLIST_RE = /y\.qq\.com\/(?:n\/)?(?:ryqq|yqq)(?:_v2)?\/playlist\/(\d+)/i;

/** H5 分享页：`taoge.html?id={id}` / `playlist.html?id={id}`（i.y.qq.com 等）。 */
const QQ_H5_PLAYLIST_RE = /y\.qq\.com\/(?:[^\s?#]*\/)?(?:taoge|playlist)\.html\?(?:[^#\s]*&)?id=(\d+)/i;

/** 歌曲分享落地页（`playsong.html?songmid=...`，不是歌单）。 */
const QQ_SONG_PAGE_RE = /playsong\.html/i;

/**
 * 从 QQ 音乐 URL 直接提取歌单 disstid（纯函数，不发请求）。
 * 覆盖 web 歌单页直链与 H5 分享页（taoge.html / playlist.html）；短链与歌曲链接
 * 返回 null。parsePlaylistUrl 的 QQ 直链分支与本模块共用此函数，避免双份正则漂移。
 */
export function extractQqPlaylistIdFromUrl(url: string): number | null {
  if (!url) return null;
  return Number(url.match(QQ_WEB_PLAYLIST_RE)?.[1] ?? url.match(QQ_H5_PLAYLIST_RE)?.[1] ?? '') || null;
}

/** 是否为歌曲分享页链接（playsong.html，非歌单）。 */
export function isQqSongLink(url: string): boolean {
  return !!url && QQ_SONG_PAGE_RE.test(url) && /[?&](songmid|songid)=[^&\s]+/i.test(url);
}

/** 是否为 QQ App 分享短链（需跟随 302 解析）。 */
export function isQqShortLink(url: string): boolean {
  return !!url && QQ_SHORT_LINK_RE.test(url);
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
