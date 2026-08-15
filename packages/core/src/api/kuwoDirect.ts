import pako from 'pako';
import iconv from 'iconv-lite';
import type { Song } from '../types/index.js';
import type { DirectSourceClient } from '../shared/sourceRouter.js';
import { request, bodyToText } from './transport.js';
import { getUserAgent } from './antiScrape.js';

/**
 * 酷我直连客户端（T08 #154）。
 *
 * 直连替代自建 API（全匿名）：
 * - 搜索：`GET www.kuwo.cn/search/searchMusicBykeyWord`（明文 JSON，abslist[]）。
 * - 播放 URL：`GET mobi.kuwo.cn/mobi.s?f=kuwo&q=<encrypted>`，query 经
 *   **自实现 DES**（key 'ylzsxkwm'，musicdl kuwoutils 位运算移植，纯 JS 双端）
 *   + base64 后传入；响应文本正则提取 http 直链。MP3 主力，无损不承诺。
 * - 歌词：`GET newlyric.kuwo.cn/newlyric.lrc?<params>`，params =
 *   base64(XOR("user=12345,...&rid=MUSIC_<id>&lrcx=1", 'yeelion'))；
 *   响应 `tp=content` 头后 zlib 压缩 → inflate → base64 → XOR('yeelion')
 *   → gb18030 解码（decodeKuwoLyricBody，pako + iconv-lite）。
 *   移动端依赖 Buffer polyfill（iconv-lite 需要），RN 侧已随依赖引入。
 *
 * 出网统一经 transport.request（T01 接缝），测试注入 mock 传输。
 */

const SEARCH_URL = 'http://www.kuwo.cn/search/searchMusicBykeyWord';
const MOBI_URL = 'http://mobi.kuwo.cn/mobi.s';
const LYRIC_URL = 'http://newlyric.kuwo.cn/newlyric.lrc';
const SECRET_KEY_SONG = new TextEncoder().encode('ylzsxkwm');
const SECRET_KEY_LYRIC = new TextEncoder().encode('yeelion');

// ── 自实现 DES（musicdl kuwoutils.py 位运算移植）──────────────────

const MASK64 = (1n << 64n) - 1n;

const ARRAYLS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const ARRAYLSMASK = [0, 0x100001, 0x300003];
const ARRAYE = [31, 0, 1, 2, 3, 4, -1, -1, 3, 4, 5, 6, 7, 8, -1, -1, 7, 8, 9, 10, 11, 12, -1, -1, 11, 12, 13, 14, 15, 16, -1, -1, 15, 16, 17, 18, 19, 20, -1, -1, 19, 20, 21, 22, 23, 24, -1, -1, 23, 24, 25, 26, 27, 28, -1, -1, 27, 28, 29, 30, 31, 30, -1, -1];
const ARRAYIP1 = [39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24];
const ARRAYIP2 = [57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7, 56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6];
const ARRAYMASK = Array.from({ length: 64 }, (_, n) => 1n << BigInt(n));
ARRAYMASK[63] = -ARRAYMASK[63];
const ARRAYP = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24];
const ARRAYPC1 = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const ARRAYPC2 = [13, 16, 10, 23, 0, 4, -1, -1, 2, 27, 14, 5, 20, 9, -1, -1, 22, 18, 11, 3, 25, 7, -1, -1, 15, 6, 26, 19, 12, 1, -1, -1, 40, 51, 30, 36, 46, 54, -1, -1, 29, 39, 50, 44, 32, 47, -1, -1, 43, 48, 38, 55, 33, 52, -1, -1, 45, 41, 49, 35, 28, 31, -1, -1];
const MATRIXNSBOX: number[][] = [
  [14, 4, 3, 15, 2, 13, 5, 3, 13, 14, 6, 9, 11, 2, 0, 5, 4, 1, 10, 12, 15, 6, 9, 10, 1, 8, 12, 7, 8, 11, 7, 0, 0, 15, 10, 5, 14, 4, 9, 10, 7, 8, 12, 3, 13, 1, 3, 6, 15, 12, 6, 11, 2, 9, 5, 0, 4, 2, 11, 14, 1, 7, 8, 13],
  [15, 0, 9, 5, 6, 10, 12, 9, 8, 7, 2, 12, 3, 13, 5, 2, 1, 14, 7, 8, 11, 4, 0, 3, 14, 11, 13, 6, 4, 1, 10, 15, 3, 13, 12, 11, 15, 3, 6, 0, 4, 10, 1, 7, 8, 4, 11, 14, 13, 8, 0, 6, 2, 15, 9, 5, 7, 1, 10, 12, 14, 2, 5, 9],
  [10, 13, 1, 11, 6, 8, 11, 5, 9, 4, 12, 2, 15, 3, 2, 14, 0, 6, 13, 1, 3, 15, 4, 10, 14, 9, 7, 12, 5, 0, 8, 7, 13, 1, 2, 4, 3, 6, 12, 11, 0, 13, 5, 14, 6, 8, 15, 2, 7, 10, 8, 15, 4, 9, 11, 5, 9, 0, 14, 3, 10, 7, 1, 12],
  [7, 10, 1, 15, 0, 12, 11, 5, 14, 9, 8, 3, 9, 7, 4, 8, 13, 6, 2, 1, 6, 11, 12, 2, 3, 0, 5, 14, 10, 13, 15, 4, 13, 3, 4, 9, 6, 10, 1, 12, 11, 0, 2, 5, 0, 13, 14, 2, 8, 15, 7, 4, 15, 1, 10, 7, 5, 6, 12, 11, 3, 8, 9, 14],
  [2, 4, 8, 15, 7, 10, 13, 6, 4, 1, 3, 12, 11, 7, 14, 0, 12, 2, 5, 9, 10, 13, 0, 3, 1, 11, 15, 5, 6, 8, 9, 14, 14, 11, 5, 6, 4, 1, 3, 10, 2, 12, 15, 0, 13, 2, 8, 5, 11, 8, 0, 15, 7, 14, 9, 4, 12, 7, 10, 9, 1, 13, 6, 3],
  [12, 9, 0, 7, 9, 2, 14, 1, 10, 15, 3, 4, 6, 12, 5, 11, 1, 14, 13, 0, 2, 8, 7, 13, 15, 5, 4, 10, 8, 3, 11, 6, 10, 4, 6, 11, 7, 9, 0, 6, 4, 2, 13, 1, 9, 15, 3, 8, 15, 3, 1, 14, 12, 5, 11, 0, 2, 12, 14, 7, 5, 10, 8, 13],
  [4, 1, 3, 10, 15, 12, 5, 0, 2, 11, 9, 6, 8, 7, 6, 9, 11, 4, 12, 15, 0, 3, 10, 5, 14, 13, 7, 8, 13, 14, 1, 2, 13, 6, 14, 9, 4, 1, 2, 14, 11, 13, 5, 0, 1, 10, 8, 3, 0, 11, 3, 5, 9, 4, 15, 2, 7, 8, 12, 15, 10, 7, 6, 12],
  [13, 7, 10, 0, 6, 9, 5, 15, 8, 4, 3, 10, 11, 14, 12, 5, 2, 11, 9, 6, 15, 12, 0, 3, 4, 1, 14, 13, 1, 2, 7, 8, 1, 2, 12, 15, 10, 4, 0, 3, 13, 14, 6, 9, 7, 8, 9, 6, 15, 1, 5, 12, 3, 10, 14, 5, 8, 7, 11, 0, 4, 13, 2, 11],
];

function u64(x: bigint): bigint { return x & MASK64; }

function bittransform(arr: number[], n: number, l: bigint): bigint {
  let acc = 0n;
  for (let i = 0; i < n; i++) {
    const idx = arr[i];
    if (idx >= 0 && (l & ARRAYMASK[idx]) !== 0n) acc |= ARRAYMASK[i];
  }
  return u64(acc);
}

function des64(longs: bigint[], l: bigint): bigint {
  const out = bittransform(ARRAYIP2, 64, l);
  const pSource: number[] = [
    Number(out & 0xffffffffn),
    Number((out >> 32n) & 0xffffffffn),
  ];
  for (let i = 0; i < 16; i++) {
    const R = bittransform(ARRAYE, 64, BigInt(pSource[1])) ^ longs[i];
    const pR: number[] = [];
    for (let j = 0; j < 8; j++) pR.push(Number((R >> BigInt(j * 8)) & 0xffn));
    let sOut = 0;
    for (let sbi = 7; sbi >= 0; sbi--) {
      sOut = (sOut << 4) | (MATRIXNSBOX[sbi][pR[sbi]] & 0xf);
    }
    const t = pSource[0] ^ Number(bittransform(ARRAYP, 32, BigInt(sOut)) & 0xffffffffn);
    pSource[0] = pSource[1];
    pSource[1] = t >>> 0;
  }
  pSource.reverse();
  const out2 = ((BigInt(pSource[1]) << 32n) & 0xffffffff00000000n) | (BigInt(pSource[0]) & 0xffffffffn);
  return u64(bittransform(ARRAYIP1, 64, out2));
}

function subkeys(lIn: bigint, longs: bigint[], mode: number): void {
  let x = bittransform(ARRAYPC1, 56, lIn);
  for (let i = 0; i < 16; i++) {
    const r = ARRAYLS[i];
    const mask = BigInt(ARRAYLSMASK[r]);
    x = u64(((x & mask) << BigInt(28 - r)) | ((x & ~mask) >> BigInt(r)));
    longs[i] = bittransform(ARRAYPC2, 64, x);
  }
  if (mode === 1) longs.reverse();
}

/** 酷我 DES（CBC 变体，无标准填充：加密恒多一个零块，解密跳过）。mode 0=加密 1=解密。 */
function crypt(msg: Uint8Array, key: Uint8Array, mode: number): Uint8Array {
  let l = 0n;
  for (let i = 0; i < 8; i++) l |= BigInt(key[i] & 0xff) << BigInt(i * 8);
  l = u64(l);
  const longs = new Array<bigint>(16).fill(0n);
  subkeys(l, longs, mode);
  const j = Math.floor(msg.length / 8);
  const outBlocks: bigint[] = [];
  for (let m = 0; m < j; m++) {
    let v = 0n;
    for (let n = 0; n < 8; n++) v |= BigInt(msg[m * 8 + n] & 0xff) << BigInt(n * 8);
    outBlocks.push(des64(longs, u64(v)));
  }
  outBlocks.push(0n);
  const rem = msg.length % 8;
  if (rem !== 0 || mode === 0) {
    let l2 = 0n;
    for (let i = 0; i < rem; i++) l2 |= BigInt(msg[j * 8 + i] & 0xff) << BigInt(i * 8);
    outBlocks[j] = des64(longs, u64(l2));
  }
  const outBytes: number[] = [];
  for (const b of outBlocks) {
    for (let i = 0; i < 8; i++) outBytes.push(Number((b >> BigInt(i * 8)) & 0xffn));
  }
  return Uint8Array.from(outBytes);
}

/** 播放 query 加密（DES + base64）。 */
export function encryptQuery(query: string): string {
  const enc = kuwoDesEncrypt(new TextEncoder().encode(query));
  return toBase64(enc);
}

/** 酷我 DES 加密（测试用原始字节；encryptQuery 的底层）。 */
export function kuwoDesEncrypt(msg: Uint8Array): Uint8Array {
  return crypt(msg, SECRET_KEY_SONG, 0);
}

export function decryptQuery(data: Uint8Array): Uint8Array {
  return crypt(data, SECRET_KEY_SONG, 1);
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function xorencrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

function buildLyricUrl(rid: string): string {
  if (!rid) return '';
  const plain = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${rid}&lrcx=1`;
  const params = toBase64(xorencrypt(new TextEncoder().encode(plain), SECRET_KEY_LYRIC));
  return `${LYRIC_URL}?${encodeURIComponent(params)}`;
}

/**
 * 酷我歌词响应解码：`tp=content` 头后 zlib 压缩 → inflate → base64 →
 * XOR('yeelion') → gb18030 解码（lrcx=1）。非 lrcx（isLyricx=false）inflate 后直解 gb18030。
 */
export function decodeKuwoLyricBody(buf: Uint8Array, isLyricx = true): string {
  const latin = new TextDecoder('latin1').decode(buf);
  if (!latin.startsWith('tp=content')) return '';
  const split = latin.indexOf('\r\n\r\n');
  if (split < 0) return '';
  try {
    const inflated = pako.inflate(buf.slice(split + 4));
    if (!isLyricx) return iconv.decode(Buffer.from(inflated), 'gb18030');
    const b64 = new TextDecoder('utf-8').decode(inflated).trim();
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const decrypted = xorencrypt(bytes, SECRET_KEY_LYRIC);
    return iconv.decode(Buffer.from(decrypted), 'gb18030');
  } catch {
    return '';
  }
}

function mapTrack(t: any): Song {
  const rid = t.rid != null ? String(t.rid) : '';
  return {
    id: rid,
    name: t.name || '',
    artist: t.artist || '',
    album: t.album || '',
    url: '',
    cover: String(t.pic || t.albumpic || '').replace(/^http:/, 'https:'),
    lrc: buildLyricUrl(rid),
    duration: Math.floor((t.duration || 0) / 1000) || 0,
    sourceType: 'kuwo',
  };
}

export const kuwoDirectClient: DirectSourceClient = {
  key: 'kuwo',

  async search(keyword: string, page = 1): Promise<Song[]> {
    const params = new URLSearchParams({
      vipver: '1',
      client: 'kt',
      ft: 'music',
      cluster: '0',
      strategy: '2012',
      encoding: 'utf8',
      rformat: 'json',
      mobi: '1',
      issubtitle: '1',
      show_copyright_off: '1',
      pn: String(page),
      rn: '30',
      all: keyword,
    });
    const res = await request({
      method: 'GET',
      url: `${SEARCH_URL}?${params.toString()}`,
      headers: { 'user-agent': getUserAgent('kuwo'), Referer: 'http://www.kuwo.cn/' },
      timeoutMs: 8000,
    });
    if (res.status >= 400) throw new Error(`酷我搜索 HTTP ${res.status}`);
    const data = JSON.parse(bodyToText(res.body)) as { abslist?: any[] };
    if (!Array.isArray(data.abslist)) throw new Error('酷我搜索响应无 abslist');
    return data.abslist.map(mapTrack).filter((s) => s.id);
  },

  async resolvePlayableUrl(song: Song): Promise<string> {
    const rid = song.id.replace(/^MUSIC_/, '');
    const query =
      `user=0&corp=kuwo&source=kwplayer_ar_5.1.0.0_B_jiakong_vh.apk&p2p=1&type=convert_url2&sig=0&format=mp3&rid=${rid}`;
    const res = await request({
      method: 'GET',
      url: `${MOBI_URL}?f=kuwo&q=${encodeURIComponent(encryptQuery(query))}`,
      headers: { 'user-agent': getUserAgent('kuwo') },
      timeoutMs: 10000,
    });
    if (res.status >= 400) throw new Error(`酷我 mobi HTTP ${res.status}`);
    const text = bodyToText(res.body);
    // 响应形如 kw:url=<直链>&br=<位率>&fmt=<格式>——URL 截断到 & 或空白
    const m = text.match(/https?:\/\/[^&\s"'<>]+/);
    if (!m) return ''; // 无可用直链 → 换元层
    return m[0];
  },
};
