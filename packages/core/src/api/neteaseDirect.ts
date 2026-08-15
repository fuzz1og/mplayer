import type { Song } from '../types/index.js';
import type { DirectSourceClient } from '../shared/sourceRouter.js';
import type { UrlInfo } from '../shared/playability.js';
import { request } from './transport.js';
import { weapiRequest } from './neteaseWeapi.js';
import { getUserAgent } from './antiScrape.js';

/**
 * 网易云直连客户端（T02 #148）。
 *
 * 直连替代自建 API 的三类请求（均匿名，无需任何 cookie）：
 * - 搜索：明文 `POST music.163.com/api/cloudsearch/pc`（form `s/type:1/limit/offset`）
 *   （直连链的搜索腿，替代自建 API 的 POST `/` 搜索）。
 * - 播放 URL：weapi `/song/enhance/player/url/v1`（level standard、encodeType mp3）。
 *   VIP/无版权 → 返回空 URL，交给换元层 / 明确不可播，不走试听。
 * - 歌词：musicApi 已有 getLyricsBySongId 直连 `api/song/lyric`，本客户端不重复实现。
 *
 * 出网统一经 transport.request（T01 接缝），测试注入 mock 传输驱动，双端（Node/RN）可用；
 * 超时用 AbortController/transport timeoutMs，不用 AbortSignal.timeout（RN 兼容）。
 *
 * `resolveUrlInfo` 提供权威完整时长验证字段（url/br/size/playTime/fee/payed），
 * 供 T12 预检做完整版 vs 试听版判定（本票只实现接口与字段映射，不做试听判定）。
 */

const CLOUDSEARCH_URL = 'https://music.163.com/api/cloudsearch/pc';
const PAGE_SIZE = 30;

/** cloudsearch 返回的网易原生 track → Song（字段映射对齐 musicApi.processNeteaseTrack）。 */
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

export const neteaseDirectClient: DirectSourceClient = {
  key: 'netease',

  /** 明文 cloudsearch 搜索。returns: 页歌曲 */
  async search(keyword: string, page = 1): Promise<Song[]> {
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
  },

  /** weapi 播放 URL；VIP/无版权返回空串 → 交给换元层 / 明确不可播。 */
  async resolvePlayableUrl(song: Song): Promise<string> {
    const info = await this.resolveUrlInfo!(song);
    return info?.url || '';
  },

  /** weapi 播放 URL 权威完整时长验证字段（T12 预检用）。无版权/VIP → null。 */
  async resolveUrlInfo(song: Song): Promise<UrlInfo | null> {
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
  },
};
