import type { Song } from '../types/index.js';
import type { DirectSourceClient, ToplistGroup } from '../shared/sourceRouter.js';
import { request, bodyToText } from './transport.js';
import { getUserAgent } from './antiScrape.js';
import { decodeBase64Utf8 } from '../utils/base64.js';
import {
  getCookie,
  generateCookie,
  shouldRotateCookie,
  randomKugouReg,
} from '../cookies/cookieManager.js';

/**
 * 酷狗直连客户端（T07 #153；内容能力 #278）。
 *
 * 直连替代自建 API（匿名设备 cookie 程序化自建）：
 * - 搜索：`GET songsearch.kugou.com/song_search_v2`（明文 JSON，lists[] 带 hash）。
 * - 播放 URL：**免签名端点**（#393，ADR 2026-09-21 决策后果）：
 *   `m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=`，取 `url` / `backup_url` 族字段
 *   （旧 `trackercdn i/v2` + MD5(hash+'kgcloudv2') 已被上游风控闸住，实测 22/22 恒空）。
 * - 歌词：两步（lyrics.kugou.com/search 拿 candidates → download 拿 base64 content），
 *   Song.lrc 记为 search URL（hash+keyword），由 musicApi.getLyrics 经
 *   `resolveKugouLyricUrl` 两步解析。
 * - 内容能力（#278 自桌面 kugouApi 私有路径并入）：`GET mobilecdn.kugou.com/api/v3/rank/song`
 *   榜单歌曲（热歌榜 8888 / 新歌榜 74534），ToplistGroup.id = `kugou:${rankid}`，
 *   rank 由消费方按索引推导。
 * - 设备 cookie：T13 cookieManager 生成/轮换（KUGOU_API_GUID/MID/MAC/DEV + dfid），
 *   请求自动携带；宿主可注入持久化 cookie。
 *
 * 出网统一经 transport.request（T01 接缝），测试注入 mock 传输。
 */

const SEARCH_URL = 'https://songsearch.kugou.com/song_search_v2';
/** 免签名播放信息端点（#393）：免签名 / 免 cookie / 免设备注册，替代被风控的 trackercdn i/v2。 */
const SONG_INFO_URL = 'https://m.kugou.com/app/i/getSongInfo.php';
const LYRIC_SEARCH_URL = 'https://lyrics.kugou.com/search';
const LYRIC_DOWNLOAD_URL = 'https://lyrics.kugou.com/download';
/**
 * 榜单歌曲接口 host（原 mobilecdn 老接口，#278 自桌面 kugouApi 挪入）。
 * 2026-09-16 实测：`mobilecdn.kugou.com` 的 https 证书是腾讯云 CDN 默认证书
 * （`*.cdn.myqcloud.com`），**不含该域名** → 任何校验证书的客户端都报
 * `ERR_TLS_CERT_ALTNAME_INVALID`，榜单腿恒空（UI 显示「暂无排行榜数据」）。
 * `mobiles.kugou.com` 同路径、同响应结构（`status=1` / `data.info[]`，50 首齐）、
 * 证书 `*.kugou.com` 有效。原 host 明文 http 仍可取数，但不做 HTTPS 降级。
 */
const RANK_SONGS_URL = 'https://mobiles.kugou.com/api/v3/rank/song';

/** 榜单定义（rankid 与桌面 kugouApi 时代一致；热歌榜 8888 / 新歌榜 74534）。 */
const KUGOU_TOPLISTS: { rankId: string; name: string }[] = [
  { rankId: '8888', name: '热歌榜' },
  { rankId: '74534', name: '新歌榜' },
];

/** 排行榜请求头（mobilecdn 老接口按移动 Web 特征出网，与原 kugouApi 一致）。 */
const RANK_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  'Referer': 'https://m.kugou.com/',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/** 取（必要时生成/轮换）酷狗设备 cookie 串；宿主持久化由 T13 cookieManager 处理。 */
export function ensureKugouCookie(): string {
  let cookie = getCookie('kugou');
  if (!cookie || shouldRotateCookie(cookie)) {
    cookie = generateCookie('kugou', { kugouReg: randomKugouReg() });
  }
  return cookie.value;
}

function mapTrack(t: any): Song {  const hash = String(t.hash || t.FileHash || '');
  const coverRaw = t.trans_param?.union_cover || t.cover_url || t.Image || '';
  const durationSec = Number(t.duration || t.Duration || 0) || Math.floor(Number(t.timelen || 0) / 1000) || 0;
  // 歌词 search 的 keyword 用歌名而不是 filename（filename 常是 “歌手 - 歌名”，
  // 直接传给 lyrics.kugou.com/search 可能导致 candidates 为空）。
  const lyricKeyword = t.songname || t.SongName || t.filename || '';
  return {
    id: hash,
    name: t.songname || t.SongName || t.filename || '',
    artist: t.singername || t.SingerName || '',
    album: t.album_name || t.AlbumName || '',
    url: '',
    cover: String(coverRaw).replace(/\{size\}/g, '300').replace(/^http:/, 'https:'),
    lrc: hash && lyricKeyword
      ? `${LYRIC_SEARCH_URL}?hash=${encodeURIComponent(hash)}&keyword=${encodeURIComponent(lyricKeyword)}`
      : '',
    duration: durationSec,
    sourceType: 'kugou',
  };
}

/**
 * 取响应里第一个**非空字符串**播放地址（#393 修正，见 resolvePlayableUrl）。
 * 不能写成 `data.url || data.backup_url || …`：付费/无版权歌实测回
 * `{ url: '', backup_url: {} }`，而 `{}` 是 truthy → 会被 `String()` 成
 * 字面量 `"[object Object]"` 当直链返回，路由层据此判「直连成功」（via=direct），
 * tier3 兜底与失败归因**全被跳过**，表现为整源歌单点不可播（#394 验收暴露出）。
 * 允许数组形态（上游字段有时是字符串数组），取第一个非空字符串。
 */
function pickPlayableUrl(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const hit = value.find((item) => typeof item === 'string' && item.trim());
      if (typeof hit === 'string') return hit.trim();
    }
  }
  return '';
}

const KG_HEADERS = (): Record<string, string> => ({
  'user-agent': getUserAgent('kugou'),
  'Referer': 'https://www.kugou.com/',
  'Cookie': ensureKugouCookie(),
});

export const kugouDirectClient: DirectSourceClient = {
  key: 'kugou',

  async searchSongs(keyword: string, page = 1): Promise<Song[]> {
    const params = new URLSearchParams({
      format: 'json',
      keyword,
      platform: 'WebFilter',
      page: String(page),
      pagesize: '30',
    });
    const res = await request({
      method: 'GET',
      url: `${SEARCH_URL}?${params.toString()}`,
      headers: KG_HEADERS(),
      timeoutMs: 8000,
    });
    if (res.status >= 400) throw new Error(`酷狗搜索 HTTP ${res.status}`);
    const data = JSON.parse(bodyToText(res.body)) as { data?: { lists?: any[] } };
    const lists = data.data?.lists || [];
    return lists.map(mapTrack).filter((s) => s.id);
  },

  /**
   * 免签名播放 URL（#393）：ADR 2026-09-21 决策后果已定「改用免签名端点」——
   * 定性是「直连被风控闸住」而非签名写错，签名端点 `i/v2` 恒回 `status:2` 且无 `data.url`。
   * 契约不变：无版权/付费歌返回空串（不抛错），交既有链路走 tier3 兜底，不做特判。
   */
  async resolvePlayableUrl(song: Song): Promise<string> {
    const params = new URLSearchParams({ cmd: 'playInfo', hash: song.id });
    const res = await request({
      method: 'GET',
      url: `${SONG_INFO_URL}?${params.toString()}`,
      headers: KG_HEADERS(),
      timeoutMs: 10000,
    });
    if (res.status >= 400) throw new Error(`酷狗 playInfo HTTP ${res.status}`);
    const data = JSON.parse(bodyToText(res.body)) as {
      url?: unknown;
      backup_url?: unknown;
      backupUrl?: unknown;
      mp3Url?: unknown;
      backupMp3Url?: unknown;
      data?: { url?: unknown; backup_url?: unknown; backupUrl?: unknown; mp3Url?: unknown; backupMp3Url?: unknown };
    };
    // 实测响应族：直链在**顶层** `url` / `backup_url`；保留嵌套 `data` 回退链，
    // 兼容不同 cmd / 客户端字段漂移（择一命中即返回，找不到返回**空串**）。
    // 必须用 pickPlayableUrl 而非 `||` 串：空对象/空数组是 truthy（见该函数注释）。
    const url = pickPlayableUrl(
      data.url,
      data.backup_url,
      data.backupUrl,
      data.mp3Url,
      data.backupMp3Url,
      data.data?.url,
      data.data?.backup_url,
      data.data?.backupUrl,
      data.data?.mp3Url,
      data.data?.backupMp3Url,
    );
    return url.replace(/^http:/, 'https:');
  },

  /**
   * 榜单（热歌榜 8888 / 新歌榜 74534；#278 自桌面 kugouApi 私有路径并入）。
   * 请求失败的单榜返回空组（保持原 kugouApi 只打摘要不上抛的语义）。
   */
  async getToplists(): Promise<ToplistGroup[]> {
    return Promise.all(
      KUGOU_TOPLISTS.map(async (t) => ({
        id: `kugou:${t.rankId}`,
        name: t.name,
        songs: await getKugouRank(t.rankId, 50),
      }))
    );
  },
};

/**
 * 榜单歌曲拉取（v3 rank/song，host 见 RANK_SONGS_URL 注释）。
 * 失败只打一行摘要返回空数组（榜单元数据在 Chart 页有兜底展示，不拖死整页）。
 */
export async function getKugouRank(rankId: string, pageSize: number = 50): Promise<Song[]> {
  try {
    const params = new URLSearchParams({
      rankid: rankId,
      page: '1',
      pagesize: String(pageSize),
    });
    const res = await request({
      method: 'GET',
      url: `${RANK_SONGS_URL}?${params.toString()}`,
      headers: RANK_HEADERS,
      timeoutMs: 15000,
    });
    if (res.status >= 400) throw new Error(`酷狗榜单 HTTP ${res.status}`);
    const data = JSON.parse(bodyToText(res.body)) as { status?: number; error?: string; data?: { info?: any[] } };
    if (data.status !== 1) {
      console.error('[kugouDirect] getKugouRank failed:', data.error);
      return [];
    }
    return (data.data?.info || []).map(mapRankSong).filter((s) => s.id);
  } catch (error) {
    // 只打一行摘要，避免 TLS/网络错误把完整证书对象刷到控制台
    console.error('[kugouDirect] getKugouRank error:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * 榜单歌曲原生字段 → Song（v3 rank/song `info[]` 形状：authors[]/album_sizable_cover）。
 * 封面 `{size}` 必须替换为**尺寸数字**（与搜索腿一致用 `300`）：`300x300` 不是有效 token，
 * 2026-09-16 实测 CDN 对无效 token 一律回默认音符图（50 首封面全同）；并统一升 https。
 */
function mapRankSong(raw: any): Song {
  const authors = (raw.authors || []).map((a: any) => a.author_name).join(' / ');
  const cover = String(raw.album_sizable_cover || '').replace(/\{size\}/g, '300').replace(/^http:/, 'https:');
  return {
    id: raw.hash || '',
    name: raw.songname || '',
    artist: authors || '',
    album: raw.albumname || '',
    url: '', // 酷狗需额外按 hash 解析音频直链
    cover,
    lrc: '',
    duration: raw.duration || 0,
    sourceType: 'kugou',
  };
}

/**
 * 酷狗歌词两步解析（供 musicApi.getLyrics 的 lyrics.kugou.com/search URL 使用）：
 * search 拿 candidates[0].{id,accesskey} → download 拿 base64 content → utf-8 解码。
 */
export async function resolveKugouLyricUrl(lrcUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(lrcUrl);
  } catch {
    return '';
  }
  const hash = url.searchParams.get('hash') || '';
  const keyword = url.searchParams.get('keyword') || '';
  if (!hash && !keyword) return '';
  const searchParams = new URLSearchParams({
    keyword: keyword || hash,
    duration: '-1',
    hash,
  });
  const searchRes = await request({
    method: 'GET',
    url: `${LYRIC_SEARCH_URL}?${searchParams.toString()}`,
    headers: KG_HEADERS(),
    timeoutMs: 8000,
  });
  if (searchRes.status >= 400) throw new Error(`酷狗歌词搜索 HTTP ${searchRes.status}`);
  const searchData = JSON.parse(bodyToText(searchRes.body)) as {
    candidates?: { id?: string; accesskey?: string }[];
  };
  const candidate = searchData.candidates?.[0];
  if (!candidate?.id || !candidate.accesskey) return '';
  const dlRes = await request({
    method: 'GET',
    url: `${LYRIC_DOWNLOAD_URL}?ver=1&client=pc&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&charset=utf8`,
    headers: KG_HEADERS(),
    timeoutMs: 8000,
  });
  if (dlRes.status >= 400) throw new Error(`酷狗歌词下载 HTTP ${dlRes.status}`);
  const dlData = JSON.parse(bodyToText(dlRes.body)) as { content?: string };
  if (typeof dlData.content !== 'string') return '';
  return decodeBase64Utf8(dlData.content);
}
