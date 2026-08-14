import type { Song } from '../types/index.js';
import type { DirectSourceClient } from '../shared/sourceRouter.js';
import { request } from './transport.js';

/**
 * 咪咕直连客户端（T05 #151）。
 *
 * 直连替代自建 API 的三类请求（均匿名，靠 ua/version/channel 伪装）：
 * - 搜索：`GET c.musicapp.migu.cn/v1.0/content/search_all.do`（明文 JSON，
 *   `text/pageNo/pageSize/isCopyright/sort/searchSwitch`，头 `ua:Android_migu、
 *   version:6.8.8、Origin/Referer: h5.nf.migu.cn`）。
 * - 播放 URL：`GET c.musicapp.migu.cn/strategy/listen-url/h5/v2.4`
 *   （`contentId/resourceType/netType/toneFlag/scene`，头 `signature:"1"、
 *   birth:"h5page"`）；响应可能是**自定义 XOR 换位流**（正文以 \xab\xcd\x01 开头、
 *   seed 在 [3]，`(byte + seed - key[i]) & 0xFF`，key 见下），解密后取 `data.url`；
 *   无版权/受限 → url 为空串，交给换元层。
 * - 歌词：搜索结果的 `lyricUrl` 是普通 LRC URL → 映射进 `Song.lrc`，
 *   由现有 `musicApi.getLyrics(lrcUrl)` 原样拉取（与 T04 千千同模式）。
 *
 * 出网统一经 transport.request（T01 接缝），测试注入 mock 传输；双端（Node/RN）可用。
 * XOR 解密为纯函数（decryptXorStream），独立导出供测试用已知向量验证。
 */

const SEARCH_URL = 'https://c.musicapp.migu.cn/v1.0/content/search_all.do';
const LISTEN_URL = 'https://c.musicapp.migu.cn/strategy/listen-url/h5/v2.4';
const MIGU_HEADERS = {
  'ua': 'Android_migu',
  'version': '6.8.8',
  'channel': '1000143',
  'Origin': 'http://h5.nf.migu.cn',
  'Referer': 'http://h5.nf.migu.cn/',
};

/** XOR 换位流密钥（musicdl migu.py `_decryptresp`，实测常量）。 */
export const XOR_KEY = 'Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP';

/**
 * 咪咕自定义 XOR 换位流解密。正文以 \xab\xcd\x01 开头时视为加密负载：
 * seed = raw[3]，`out[i] = (raw[i+4] + seed - key[i % len]) & 0xFF`。
 * 无加密前缀则原样返回（非加密响应）。
 */
export function decryptXorStream(raw: Uint8Array): Uint8Array {
  if (raw.length < 4 || raw[0] !== 0xab || raw[1] !== 0xcd || raw[2] !== 0x01) {
    return raw;
  }
  const seed = raw[3];
  const out = new Uint8Array(raw.length - 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = (raw[i + 4] + seed - XOR_KEY.charCodeAt(i % XOR_KEY.length)) & 0xff;
  }
  return out;
}

function toBytes(body: string | ArrayBuffer): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
}

function toText(body: string | ArrayBuffer): string {
  return typeof body === 'string' ? body : new TextDecoder().decode(body);
}

/** cloudsearch 返回的咪咕原生 track → Song（字段名以实测/文档假设为准）。 */
function mapTrack(t: any): Song {
  const rawArtists = t.singer ?? t.artists ?? [];
  const artists = Array.isArray(rawArtists)
    ? rawArtists
        .map((a: any) => (typeof a === 'string' ? a : a?.name || a?.singerName || ''))
        .filter(Boolean)
    : [String(rawArtists || '')];
  const album = typeof t.album === 'string' ? t.album : t.album?.name || t.albums?.[0]?.name || '';
  const cover =
    (Array.isArray(t.albumImgs) ? t.albumImgs[0]?.img : t.albumImg) || t.albumPic || '';
  return {
    id: String(t.songId ?? t.contentId ?? ''),
    name: t.songName || t.name || '',
    artist: artists.join(' / '),
    album,
    url: '',
    cover: String(cover || '').replace(/^http:/, 'https:'),
    lrc: String(t.lyricUrl || '').replace(/^http:/, 'https:'),
    duration: Math.floor((t.interval || t.duration || 0) / 1000) || 0,
    sourceType: 'migu',
  };
}

export const miguDirectClient: DirectSourceClient = {
  key: 'migu',

  async search(keyword: string, page = 1): Promise<Song[]> {
    const params = new URLSearchParams({
      text: keyword,
      pageNo: String(page),
      pageSize: '30',
      isCopyright: '1',
      sort: '1',
      searchSwitch: JSON.stringify({ song: 1, album: 0, singer: 0, tagSong: 0, mvSong: 0, songlist: 0, bestShow: 1 }),
    });
    const res = await request({
      method: 'GET',
      url: `${SEARCH_URL}?${params.toString()}`,
      headers: MIGU_HEADERS,
      timeoutMs: 8000,
    });
    if (res.status >= 400) throw new Error(`migu 搜索 HTTP ${res.status}`);
    const data = JSON.parse(toText(res.body)) as {
      code?: string | number;
      data?: { songList?: any[] };
    };
    if (String(data.code) !== '000000') throw new Error(`migu 搜索 code=${String(data.code)}`);
    return (data.data?.songList || []).map(mapTrack).filter((s) => s.id);
  },

  async resolvePlayableUrl(song: Song): Promise<string> {
    const params = new URLSearchParams({
      contentId: song.id,
      resourceType: '2',
      netType: '01',
      toneFlag: 'PQ',
      scene: '',
    });
    const res = await request({
      method: 'GET',
      url: `${LISTEN_URL}?${params.toString()}`,
      headers: {
        ...MIGU_HEADERS,
        'signature': '1',
        'birth': 'h5page',
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeoutMs: 10000,
    });
    if (res.status >= 400) throw new Error(`migu listen HTTP ${res.status}`);
    const decrypted = decryptXorStream(toBytes(res.body));
    const data = JSON.parse(new TextDecoder().decode(decrypted)) as {
      data?: { url?: string };
    };
    return (data.data?.url || '').replace(/^http:/, 'https:');
  },
};
