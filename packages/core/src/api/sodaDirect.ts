import type { Song } from '../types/index.js';
import type { DirectSourceClient } from '../shared/sourceRouter.js';
import { request } from './transport.js';
import { BROWSER_UA } from '../utils/sourceReferer.js';
import { musicApi } from './musicApi.js';

/**
 * 汽水直连客户端（T03 #149，收尾）。
 *
 * 汽水已全直连（musicApi 的 api.qishui.com 搜索 / _ROUTER_DATA 分享页直链 /
 * track_v2 兜底），本客户端把这些既有直连注册进 sourceRouter，并补齐：
 * - resolvePlayableUrl：**分享页直链优先**（musicApi.getSodaAudioUrl 已实现
 *   分享页 → track_v2 降级），这里薄包装。
 * - resolveUrlInfo：track_v2 的权威完整时长字段（duration/play_info_list.size/
 *   bitrate，供 T12 预检做完整版 vs 试听版判定），经 transport 接缝实现。
 *
 * 注册后设置页「汽水=直连可用」，且 auto 模式播放 URL 经路由直连。
 */

const TRACK_V2_URL = 'https://api.qishui.com/luna/pc/track_v2';

function toText(body: string | ArrayBuffer): string {
  return typeof body === 'string' ? body : new TextDecoder().decode(body);
}

export const sodaDirectClient: DirectSourceClient = {
  key: 'soda',

  /** 复用 musicApi 既有汽水直连搜索。 */
  search: (keyword, page = 1) => musicApi.searchSongsSoda(keyword, page),

  /** 分享页直链优先（musicApi.getSodaAudioUrl 已实现），失败降级 track_v2。 */
  resolvePlayableUrl: (song) => musicApi.getSodaAudioUrl(song.id),

  /** 权威完整时长字段：track_v2 play_info_list 取最大档 size/bitrate + duration。 */
  async resolveUrlInfo(song: Song) {
    const params = new URLSearchParams({
      track_id: song.id,
      media_type: 'track',
      aid: '386088',
      device_platform: 'web',
      channel: 'pc_web',
    });
    const res = await request({
      method: 'GET',
      url: `${TRACK_V2_URL}?${params.toString()}`,
      headers: { 'user-agent': BROWSER_UA },
      timeoutMs: 10000,
    });
    if (res.status >= 400) throw new Error(`汽水 track_v2 HTTP ${res.status}`);
    const data = JSON.parse(toText(res.body)) as {
      track?: { duration?: number; audio_info?: { play_info_list?: { size?: number; bitrate?: number; main_play_url?: string; backup_play_url?: string; play_auth?: string }[] } };
    };
    const track = data.track;
    const list = track?.audio_info?.play_info_list;
    if (!track || !list || list.length === 0) return null;
    const best = list.reduce((a, b) => (a.size || 0) > (b.size || 0) ? a : b);
    const url = String(best.main_play_url || best.backup_play_url || '').replace(/^http:/, 'https:');
    const auth = best.play_auth || '';
    return {
      url: auth ? `${url}?play_auth=${encodeURIComponent(auth)}` : url,
      br: best.bitrate || 0,
      size: best.size || 0,
      playTime: Math.floor(track.duration || 0),
      fee: 0,
      payed: 1,
    };
  },
};
