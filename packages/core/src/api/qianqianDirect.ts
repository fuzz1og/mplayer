import type { Song } from '../types/index.js';
import type { DirectSourceClient } from '../shared/sourceRouter.js';
import { request, cappedRequestTimeout, type TransportCallOptions } from './transport.js';
import { md5 } from '../utils/hash.js';
import { getUserAgent } from './antiScrape.js';

/**
 * - 播放 URL：`GET music.91q.com/v1/song/tracklink`，query `{TSID, appid, rate}` + sign，取 
 * `data.path` 或 `data.trail_audio_info.path`；无有效 URL（VIP/无版权）返回空串交给换元层 / 明确不
 * 可播。
 */

const APPID = '16073360';
const SEARCH_URL = 'https://music.91q.com/v1/search';
const TRACKLINK_URL = 'https://music.91q.com/v1/song/tracklink';
const SECRET = '0b50b02fd0d73a9c4c8c3a781c30845f';
/** 播放档位按降序尝试；web 源常用 320（musicdl 顺序 3000→320→128→64）。这里取 320 起步。 */
const RATES = ['320', '128', '64'];

const BASE_HEADERS = (): Record<string, string> => ({
  'referer': 'https://music.91q.com/player',
  'from': 'web',
  'User-Agent': getUserAgent('qianqian'),
  'accept': 'application/json, text/javascript, */*; q=0.01',
});

/** 补 timestamp + 计算 MD5 签名：sign = md5(sorted_kv + secret)。返回完整 query 参数表。 */
function signedParams(params: Record<string, string>): Record<string, string> {
  const withTs: Record<string, string> = {
    ...params,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const sorted = Object.keys(withTs)
    .sort()
    .map((k) => `${k}=${withTs[k]}`)
    .join('&');
  return { ...withTs, sign: md5(sorted + SECRET) };
}

/** GET + 签名 query，返回响应 JSON；非 2xx 抛错。 */
async function signedGet<T>(url: string, params: Record<string, string>, opts?: TransportCallOptions): Promise<T> {
  const query = new URLSearchParams(signedParams(params));
  const res = await request({
    method: 'GET',
    url: `${url}?${query.toString()}`,
    headers: { ...BASE_HEADERS() },
    timeoutMs: cappedRequestTimeout(8000, opts),
    signal: opts?.signal,
  });
  if (typeof res.body !== 'string') {
    throw new Error('qianqian 响应非文本');
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`qianqian HTTP ${res.status}`);
  }
  return JSON.parse(res.body) as T;
}

interface QianqianTrack {
  TSID?: string | number;
  title?: string;
  artist?: { name?: string }[];
  albumTitle?: string;
  pic?: string;
  lyric?: string;
}

function mapTrack(t: QianqianTrack): Song {
  return {
    id: String(t.TSID ?? ''),
    name: t.title || '',
    artist: (t.artist || []).map((a) => a?.name || '').filter(Boolean).join(' / '),
    album: t.albumTitle || '',
    url: '',
    cover: t.pic || '',
    lrc: t.lyric || '',
    duration: 0,
    sourceType: 'qianqian',
  };
}

export const qianqianDirectClient: DirectSourceClient = {
  key: 'qianqian',

  /** 千千搜索直连。returns: 页歌曲（含 lrc 直连 URL）。`opts`（#556 评审 A1）透传墙钟与取消。 */
  async searchSongs(keyword: string, page = 1, opts?: TransportCallOptions): Promise<Song[]> {
    const data = await signedGet<{ data?: { typeTrack?: QianqianTrack[] } }>(SEARCH_URL, {
      word: keyword,
      type: '1',
      pageNo: String(page),
      pageSize: '10',
      appid: APPID,
    }, opts);
    return (data.data?.typeTrack || []).map(mapTrack);
  },

  /** 千千播放 URL 直连；VIP/无版权无有效 URL → 返回空串（交换元层 / 明确不可播）。 */
  async resolvePlayableUrl(song: Song, opts?: TransportCallOptions): Promise<string> {
    for (const rate of RATES) {
      const data = await signedGet<{
        data?: {
          path?: string;
          trail_audio_info?: { path?: string };
        };
      }>(TRACKLINK_URL, { TSID: song.id, appid: APPID, rate }, opts);
      const path = data.data?.path || data.data?.trail_audio_info?.path || '';
      if (path && path.startsWith('http')) {
        return path.startsWith('http:') ? path.replace(/^http:/, 'https:') : path;
      }
    }
    return '';
  },
};
