import CryptoJS from 'crypto-js';
import type { Song } from '../types/index.js';
import type { DirectSourceClient, ToplistGroup } from '../shared/sourceRouter.js';
import { request } from './transport.js';
import { md5 } from '../utils/hash.js';
import { decodeBase64Utf8 } from '../utils/base64.js';
import { getUserAgent } from './antiScrape.js';
import { cacheManager } from './memoryCacheManager.js';

/**
 * QQ 音乐直连客户端（T06 #152）。
 *
 * 直连替代自建 API（匿名免费/低音质档起步，更高音质不承诺）：
 * - 搜索 / 播放 URL：`POST u.y.qq.com/cgi-bin/musicu.fcg` 统一网关
 *   （DoSearchForQQMusicMobile / UrlGetVkey），comm 携带 QIMEI36 设备指纹。
 * - QIMEI：`POST api.tencentmusic.com/tme/trpc/proxy`，RSA-PKCS1v15 包 AES-CBC
 *   密钥 + MD5 签名（musicdl qqutils 算法，纯 JS 双端可用）；失败兜底静态 q36。
 * - 歌词：fcg_query_lyric_new.fcg（songmid 键控，`lyric` 为 base64 LRC）→ 构造为
 *   `Song.lrc` URL，由 `musicApi.getLyrics` 增强（补 Referer + 解码 base64 JSON）消费。
 * - 榜单：v8 fcg toplist（热歌榜 26 / 新歌榜 27，#279 自门面迁入）。
 *
 * 出网统一经 transport.request（T01 接缝），测试注入 mock 传输；双端（Node/RN）可用。
 */

const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QIMEI_URL = 'https://api.tencentmusic.com/tme/trpc/proxy';
const QIMEI_SECRET = 'ZdJqM15EeO2zWc08';
const QIMEI_APP_KEY = '0AND0HD6FE4HY80F';
/** QQ 公钥模数（1024 位 hex，自 musicdl qqutils PUBLIC_KEY 的 SPKI DER 解出）。 */
const QQ_RSA_MODULUS = BigInt(
  '0xc4231830a2eb5fc2827170641e79d80fec51bda9a22e4b4ab37d1f205a4ae44d928cda25879f66a3429051663312a127faf8a246bdaaf63918417e90d7c95b5908aa6a2d0f852e4a6770294a548ac1c2fe8f1f252fb826f4ac86ab9a00e7ce47d002a56e7c4b51eb889acc60ca6adbc9f72e81f4d31b1dd7464805264530ab1d',
);
const QQ_RSA_EXPONENT = 65537n;
const MODULUS_BYTES = 128;
const QIMEI_FALLBACK_Q36 = '6c9d3cd110abca9b16311cee10001e717614';
const RANDOM_ALPHABET = 'adbcdef1234567890';

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** RSA-PKCS1v15 加密：EM = 0x00 0x02 || PS(随机非零) || 0x00 || M（M ≤ 117 字节）。 */
export function rsaPkcs1v15Encrypt(data: Uint8Array): Uint8Array {
  const psLen = MODULUS_BYTES - data.length - 3;
  if (psLen < 8) throw new Error('QQ RSA 消息过长');
  const em = new Uint8Array(MODULUS_BYTES);
  em[0] = 0x00;
  em[1] = 0x02;
  for (let i = 0; i < psLen; i++) em[2 + i] = 1 + Math.floor(Math.random() * 255);
  em[2 + psLen] = 0x00;
  em.set(data, 3 + psLen);
  let m = 0n;
  for (const b of em) m = (m << 8n) | BigInt(b);
  const c = modPow(m, QQ_RSA_EXPONENT, QQ_RSA_MODULUS);
  const hex = c.toString(16).padStart(MODULUS_BYTES * 2, '0');
  const out = new Uint8Array(MODULUS_BYTES);
  for (let i = 0; i < MODULUS_BYTES; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** AES-128-CBC（key 兼作 IV）+ PKCS7 加密，返回密文字节。 */
export function aesCbcPkcs7Encrypt(keyUtf8: string, plaintext: string): Uint8Array {
  const cipher = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(plaintext),
    CryptoJS.enc.Utf8.parse(keyUtf8),
    { iv: CryptoJS.enc.Utf8.parse(keyUtf8), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  );
  const wa = cipher.ciphertext;
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) {
    out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function randomFrom(alphabet: string, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function randomHex(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** GetVkey 的 32 位随机 guid。 */
export function randomGuid(): string {
  return randomHex(32);
}

function randomImei(): string {
  let out = '';
  for (let i = 0; i < 15; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function randomBeaconId(): string {
  let id = '';
  const month = new Date().toISOString().slice(0, 7) + '-01';
  const rand1 = Math.floor(100000 + Math.random() * 900000);
  const rand2 = Math.floor(100000000 + Math.random() * 900000000);
  for (let i = 1; i <= 40; i++) {
    if ([1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38].includes(i)) {
      id += `k${i}:${month}${rand1}.${rand2}`;
    } else if (i === 3) {
      id += 'k3:0000000000000000';
    } else if (i === 4) {
      id += `k4:${randomFrom('123456789abcdef', 16)}`;
    } else {
      id += `k${i}:${Math.floor(Math.random() * 10000)}`;
    }
    id += ';';
  }
  return id;
}

function buildQimeiPayload(): Record<string, unknown> {
  const uptimes = new Date(Date.now() - Math.floor(Math.random() * 14400) * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  return {
    androidId: randomHex(16),
    platformId: 1,
    appKey: QIMEI_APP_KEY,
    appVersion: '8.9.105',
    beaconIdSrc: randomBeaconId(),
    brand: 'Xiaomi',
    channelId: '10003505',
    cid: '',
    imei: randomImei(),
    imsi: '',
    mac: '',
    model: 'MI 6',
    networkType: 'unknown',
    oaid: '',
    osVersion: 'Android 10,level 29',
    qimei: '',
    qimei36: '',
    sdkVersion: '1.2.13.6',
    targetSdkVersion: '33',
    audit: '',
    userId: '{}',
    packageId: 'com.tencent.qqmusic',
    deviceType: 'Phone',
    sdkName: '',
    reserved: JSON.stringify({
      harmony: '0',
      oz: 'UhYmelwouA+V2nPWbOvLTgN2/m8jwGB+yUB5v9tysQg=',
      oo: 'Xecjt+9S1+f8Pz2VLSxgpw==',
      kelong: '0',
      uptimes,
      clone: '0',
      containe: '',
      multiUser: '0',
      bod: 'Xiaomi',
      dv: 'sagit',
      firstLevel: '',
      manufact: 'Xiaomi',
      name: 'MI 6',
      host: 'se.infra',
      kernel: 'Linux 5.4.0-54-generic-aaaa1111 (android-build@google.com)',
    }),
  };
}

/** 获取 QIMEI36 设备指纹（会话内缓存；失败用静态兜底值，匿名可用）。 */
export async function obtainQimei(): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const payload = buildQimeiPayload();
  const cryptKey = randomFrom(RANDOM_ALPHABET, 16);
  const nonce = randomFrom(RANDOM_ALPHABET, 16);
  const key = toBase64(rsaPkcs1v15Encrypt(new TextEncoder().encode(cryptKey)));
  const params = toBase64(aesCbcPkcs7Encrypt(cryptKey, JSON.stringify(payload)));
  const extra = JSON.stringify({ appKey: QIMEI_APP_KEY });
  const sign = md5(key + params + String(ts * 1000) + nonce + QIMEI_SECRET + extra);
  try {
    const res = await request({
      method: 'POST',
      url: QIMEI_URL,
      headers: {
        'Host': 'api.tencentmusic.com',
        'method': 'GetQimei',
        'service': 'trpc.tme_datasvr.qimeiproxy.QimeiProxy',
        'appid': 'qimei_qq_android',
        'sign': md5('qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH' + String(ts)),
        'user-agent': 'QQMusic',
        'timestamp': String(ts),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ app: 0, os: 1, qimeiParams: { key, params, time: String(ts), nonce, sign, extra } }),
      timeoutMs: 8000,
    });
    const outer = JSON.parse(
      typeof res.body === 'string' ? res.body : new TextDecoder().decode(res.body),
    ) as { data?: string };
    const inner = JSON.parse(outer.data || '{}') as { data?: { q36?: string } };
    return inner.data?.q36 || QIMEI_FALLBACK_Q36;
  } catch {
    return QIMEI_FALLBACK_Q36;
  }
}

let cachedQ36: string | null = null;

/** 测试/热重置用：清空会话级 QIMEI 缓存。 */
export function resetQqDirectForTests(): void {
  cachedQ36 = null;
}

async function ensureQ36(): Promise<string> {
  if (!cachedQ36) cachedQ36 = await obtainQimei();
  return cachedQ36;
}

function buildCommon(q36: string): Record<string, unknown> {
  return { cv: 1601, v: 1601, QIMEI36: q36 };
}

export function buildLyricUrl(songmid: string): string {
  if (!songmid) return '';
  const p = new URLSearchParams({
    songmid,
    g_tk: '5381',
    loginUin: '0',
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    platform: 'yqq',
  });
  return `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${p.toString()}`;
}

export function mapTrack(t: any): Song {
  const mid = t.mid || t.songmid || '';
  const albumMid = t.album?.mid || '';
  return {
    id: String(mid),
    name: t.title || t.name || '',
    artist: (t.singer || []).map((s: any) => s?.name || '').filter(Boolean).join(' / '),
    album: t.album?.name || '',
    url: '',
    cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '',
    lrc: buildLyricUrl(mid),
    duration: Math.floor(t.interval || 0) || 0,
    sourceType: 'qq',
  };
}

const MUSICU_HEADERS = {
  'content-type': 'application/json',
  'user-agent': getUserAgent('qq'),
  'Referer': 'https://y.qq.com/',
};

export async function musicuPost(body: Record<string, unknown>): Promise<any> {
  const res = await request({
    method: 'POST',
    url: MUSICU_URL,
    headers: MUSICU_HEADERS,
    body: JSON.stringify(body),
    timeoutMs: 8000,
  });
  if (res.status >= 400) throw new Error(`QQ musicu HTTP ${res.status}`);
  return JSON.parse(typeof res.body === 'string' ? res.body : new TextDecoder().decode(res.body));
}

// ── 榜单（#279 自门面 getQQToplist/getQQHotlist/getQQNewSongList 迁入）──────
//
// 端点 = v8 fcg toplist（GET c.y.qq.com，匿名可用，2026-08 实测）。musicu 网关的
// musicToplist.ToplistInfoServer.GetToplist 匿名恒拒（code 500005，实测），故榜单
// id 沿用 v8 端点的 topid（热歌榜 26 / 新歌榜 27），即 `qq:26` / `qq:27`。
// 请求走 qqDirect 现有 transport 接缝（桌面 axios 代理/RN 网络栈统一，可 mock）。

const TOPLIST_URL = 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg';
const TOPLIST_TTL_MS = 24 * 60 * 60 * 1000; // 榜单日更，与原门面 hotlist 缓存 TTL 一致
const QQ_TOPLIST_CACHE_KEY = 'qq_toplists';

const QQ_TOPLISTS: { topid: number; name: string }[] = [
  { topid: 26, name: '热歌榜' },
  { topid: 27, name: '新歌榜' },
];

const TOPLIST_HEADERS = {
  'user-agent': getUserAgent('qq'),
  'Referer': 'https://y.qq.com/',
  'Accept': '*/*',
};

function toplistUrl(topid: number, date: string): string {
  const p = new URLSearchParams({
    newsong: '1',
    tpl: '3',
    page: 'detail',
    date,
    topid: String(topid),
    type: 'top',
    song_begin: '0',
    song_num: '100',
    g_tk: '5381',
    format: 'json',
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    notice: '0',
  });
  return `${TOPLIST_URL}?${p.toString()}`;
}

/**
 * v8 榜单单曲 → Song（原门面 mapQQToplistItem 语义，HotlistSong 视图废）。
 * id **优先取 songmid**：GetVkey 直连腿按 songmid 键控，数字 id 走直连恒为空
 * （与无版权/VIP 无关），整榜 100% 依赖 tier3、探测预取全部无效（#172）。
 * 数字 id 仅在响应缺失 mid 时兜底。rank 不落结构——消费方按索引推导。
 */
function mapToplistTrack(item: any): Song | null {
  const songData = item?.data;
  if (!songData) return null;
  const albumMid = songData.album?.mid || '';
  return {
    id: songData.mid || songData.id?.toString() || '',
    name: songData.name || '',
    artist: (songData.singer || []).map((singer: any) => singer?.name || '').filter(Boolean).join('/'),
    album: songData.album?.name || '',
    url: '',
    cover: albumMid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}_1.jpg`
      : '',
    lrc: '',
    duration: Math.floor(songData.interval || 0) || 0,
    sourceType: 'qq',
  };
}

/** 解析 v8 响应体（字符串/字节均可能）。 */
function parseToplistResponse(res: { body: string | Uint8Array | ArrayBuffer }): { code?: number; songlist?: unknown[] } {
  return JSON.parse(typeof res.body === 'string' ? res.body : new TextDecoder().decode(res.body));
}

/** 拉单榜歌曲；失败只打一行摘要返回空数组（榜单元数据在消费页有兜底，不拖死整页）。 */
async function fetchToplistSongs(topid: number): Promise<Song[]> {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  try {
    let res = await request({ method: 'GET', url: toplistUrl(topid, dateStr), headers: TOPLIST_HEADERS, timeoutMs: 30000 });
    if (res.status >= 400) throw new Error(`QQ 榜单 HTTP ${res.status}`);
    let data = parseToplistResponse(res);

    // 今天的数据还没更新（code≠0）→ 回退昨天的日期
    if (data.code !== 0) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      res = await request({
        method: 'GET',
        url: toplistUrl(topid, yesterday.toISOString().split('T')[0]),
        headers: TOPLIST_HEADERS,
        timeoutMs: 30000,
      });
      if (res.status >= 400) throw new Error(`QQ 榜单 HTTP ${res.status}`);
      data = parseToplistResponse(res);
    }

    const songlist = data.songlist;
    if (!Array.isArray(songlist)) {
      throw new Error(`无法解析QQ音乐排行榜数据 (topid=${topid})，songlist不是数组`);
    }
    return songlist.map(mapToplistTrack).filter((s: Song | null): s is Song => !!s && !!s.id);
  } catch (error) {
    console.error(`[qqDirect] getToplists 失败 (topid=${topid}):`, error instanceof Error ? error.message : error);
    return [];
  }
}

export const qqDirectClient: DirectSourceClient = {
  key: 'qq',

  async searchSongs(keyword: string, page = 1): Promise<Song[]> {
    const q36 = await ensureQ36();
    const body = {
      comm: buildCommon(q36),
      'music.search.SearchCgiService.DoSearchForQQMusicMobile': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicMobile',
        param: {
          searchid: randomFrom('abcdef1234567890', 32),
          query: keyword,
          search_type: 0,
          num_per_page: 30,
          page_num: page,
          highlight: 1,
          grp: 1,
        },
      },
    };
    const data = await musicuPost(body);
    const moduleRes = data['music.search.SearchCgiService.DoSearchForQQMusicMobile'];
    if (moduleRes?.code !== 0) throw new Error(`QQ 搜索 code=${String(moduleRes?.code)}`);
    // 新版 musicu 返回 `data.body.item_song`；旧版是 `data.song.list`，这里兼容两者。
    const list = moduleRes?.data?.body?.item_song || moduleRes?.data?.song?.list || [];
    return list.map(mapTrack).filter((s: Song) => s.id);
  },

  async resolvePlayableUrl(song: Song): Promise<string> {
    const q36 = await ensureQ36();
    const mid = song.id;
    const body = {
      comm: buildCommon(q36),
      'music.vkey.GetVkey.UrlGetVkey': {
        module: 'music.vkey.GetVkey',
        method: 'UrlGetVkey',
        param: {
          filename: [`M800${mid}${mid}.mp3`],
          guid: randomGuid(),
          songmid: [mid],
          songtype: [0],
        },
      },
    };
    const data = await musicuPost(body);
    const moduleRes = data['music.vkey.GetVkey.UrlGetVkey'];
    if (moduleRes?.code !== 0) throw new Error(`QQ GetVkey code=${String(moduleRes?.code)}`);
    const purl = moduleRes?.data?.midurlinfo?.[0]?.purl || '';
    if (!purl) return ''; // 无版权/VIP → 换元层
    return `https://isure.stream.qqmusic.qq.com/${purl}`;
  },

  /**
   * 榜单全集（热歌榜 26 / 新歌榜 27；#279 自门面迁入）。
   * 单榜失败返回空组（保持原门面失败不抛语义）；至少一榜有歌才写缓存。
   */
  async getToplists(): Promise<ToplistGroup[]> {
    const cached = cacheManager.get<ToplistGroup[]>(QQ_TOPLIST_CACHE_KEY);
    if (cached && cached.length > 0) return cached;
    const groups = await Promise.all(
      QQ_TOPLISTS.map(async (t) => ({
        id: `qq:${t.topid}`,
        name: t.name,
        songs: await fetchToplistSongs(t.topid),
      })),
    );
    if (groups.some((g) => g.songs.length > 0)) {
      cacheManager.set(QQ_TOPLIST_CACHE_KEY, groups, TOPLIST_TTL_MS);
    }
    return groups;
  },
};

/**
 * 网关取歌词（GetPlayLyricInfo）：与搜索/GetVkey 同一 musicu POST 通道，
 * 服务端不做 Referer 防盗链校验——c.y.qq.com fcg GET 强制 Referer，而 RN
 * 网络栈发出的该请求在真机上被拒（桌面 Chromium/Node 栈正常），移动端歌词
 * 因此拿不到；此函数是 getLyrics 的 QQ 兜底腿（真机已验证该通道可用）。
 * 注意：param 里 songID 键必须整个省略——服务端按 songMID 自查数字 id，
 * 显式传 0/空串/字符串都会被拒（实测 10006/24001）。qrc/crypt 关掉才返回
 * base64 明文 LRC（开启返回加密 QRC hex）。
 */
export async function fetchLyricViaGateway(mid: string): Promise<string> {
  if (!mid) return '';
  const q36 = await ensureQ36();
  const data = await musicuPost({
    comm: buildCommon(q36),
    'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo': {
      module: 'music.musichallSong.PlayLyricInfo',
      method: 'GetPlayLyricInfo',
      param: { songMID: mid, qrc: 0, crypt: 0, trans: 0, dec: 0 },
    },
  });
  const moduleRes = data['music.musichallSong.PlayLyricInfo.GetPlayLyricInfo'];
  if (moduleRes?.code !== 0) throw new Error(`QQ 歌词网关 code=${String(moduleRes?.code)}`);
  const b64 = moduleRes?.data?.lyric || '';
  if (!b64) return ''; // 纯音乐/无歌词
  return decodeBase64Utf8(b64);
}
