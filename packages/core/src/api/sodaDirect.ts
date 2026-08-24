import type { Song } from '../types/index.js';
import type { DirectSourceClient } from '../shared/sourceRouter.js';
import type { UrlInfo } from '../shared/playability.js';
import { request, bodyToText } from './transport.js';
import { getUserAgent } from './antiScrape.js';
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

export const sodaDirectClient: DirectSourceClient = {
  key: 'soda',

  /** 复用 musicApi 既有汽水直连搜索。 */
  search: (keyword, page = 1) => musicApi.searchSongsSoda(keyword, page),

  /** 分享页直链优先（musicApi.getSodaAudioUrl 已实现），失败降级 track_v2。 */
  resolvePlayableUrl: (song) => musicApi.getSodaAudioUrl(song.id),

  /** 权威完整时长字段：track_v2 play_info_list 取最大档 size/bitrate + duration。
   *  匿名 track_v2 返回 200 空 body（2026-08 实测，需 PC 登录态 Cookie），
   *  空 body 时降级分享页（fetchSodaSharePage 的 duration 字段，免登录），
   *  分享页也失败则返回 null（探测标不可用，不再抛错卡链路）。 */
  async resolveUrlInfo(song: Song) {
    const params = new URLSearchParams({
      track_id: song.id,
      media_type: 'track',
      aid: '386088',
      device_platform: 'web',
      channel: 'pc_web',
    });
    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request({
        method: 'GET',
        url: `${TRACK_V2_URL}?${params.toString()}`,
        headers: { 'user-agent': getUserAgent('soda') },
        timeoutMs: 10000,
      });
    } catch {
      res = { status: 0, headers: {}, body: new Uint8Array(), finalUrl: '' } as any;
    }
    if (res.status >= 400) throw new Error(`汽水 track_v2 HTTP ${res.status}`);
    const text = bodyToText(res.body);
    if (text.trim()) {
      try {
        const data = JSON.parse(text) as {
          track?: { duration?: number; audio_info?: { play_info_list?: { size?: number; bitrate?: number; main_play_url?: string; backup_play_url?: string; play_auth?: string }[] } };
        };
        const track = data.track;
        const list = track?.audio_info?.play_info_list;
        // 有效 JSON：有 play_info_list 走原逻辑；track 存在但列表为空 → 无可用音源，直接 null（不降级）
        if (track) {
          if (!list || list.length === 0) return null;
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
          } satisfies UrlInfo;
        }
      } catch {
        // JSON 解析失败（非 JSON/半截响应）：落分享页降级
      }
    }
    // 空 body / 无 track / 解析失败 → 分享页免登录降级（trackInfo.duration 权威完整时长）
    try {
      const page = await musicApi.fetchSodaSharePage(song.id);
      if (!page || !page.durationMs) return null;
      return {
        url: page.audioUrl,
        br: 0,
        size: 0,
        playTime: Math.floor(page.durationMs / 1000),
        fee: 0,
        payed: 1,
      } satisfies UrlInfo;
    } catch {
      return null;
    }
  },
};
