import { request } from './transport.js';
import { URL_ALIVE_PROBE_TIMEOUT_MS } from '../shared/playbackBudgets.js';

// 活性闸请求头：带浏览器 UA + 按源推导的官方 Referer（映射见 utils/sourceReferer.ts）。⚠️ **不要把「不带/带错 Referer 会 403」当事实**——
// 那句话无出处；2026-10-16 五臂实测 45 次请求全 200 且字节一致，该前提**未被证实**（#647、ADR 2026-10-08）。
// 保留这份头的理由是「无害且可能覆盖未测档位」，不是「已证有必要」。
import { BROWSER_UA, refererForUrl } from '../utils/sourceReferer.js';

function probeRequestHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
  const referer = refererForUrl(url);
  if (referer) headers['Referer'] = referer;
  return headers;
}

/**
 * 播放期直链活性闸的 Range GET：统一走传输层（与直连客户端/歌词门面同一接缝，302 由 axios 自动跟随到 CDN 直链），
 * 并带浏览器 UA + 按源推导的 Referer（无害；是否必要见文件头 ⚠️ 与 #647）。网络异常直接上抛——极性由调用方定义。
 */
async function rangedGet(url: string, rangeEnd: number, timeoutMs: number) {
  return request({
    method: 'GET',
    url,
    headers: { Range: `bytes=0-${rangeEnd}`, ...probeRequestHeaders(url) },
    responseType: 'arraybuffer',
    timeoutMs,
  });
}

/**
 * 播放期直链活性闸：缓存命中的 URL 在交给播放器前快速确认活着。
 * #391：批量可播性探测（probeAudioUrl/probeAudio）已删除——判据反向（把「直连拿不到 URL」判成失效
 * ，而多数歌靠 tier3 才可播）且产物无消费者；本模块只保留这条活性闸。
 */
export async function isUrlAlive(rawUrl: string, timeoutMs = URL_ALIVE_PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const url = normalizeProbeUrl(rawUrl);
    if (!url.startsWith('http')) return false;
    const resp = await rangedGet(url, 0, timeoutMs);
    const ct = String(resp.headers['content-type'] || '');
    return resp.status < 400 && !ct.includes('text/html');
  } catch {
    return false;
  }
}

export function normalizeProbeUrl(url: string, baseUrl?: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  // Relative path - use provided base URL or fallback
  const base = baseUrl || '';
  return base + url.replace(/^\//, '');
}

// ── 完整时长校验（T12 #158）────────────────────────────────────────
// 实现位于 shared/playability.ts（叶子模块，避免 sourceRouter → audioProbe →
// musicApi 循环导入）；此处 re-export 保持 audioProbe 的「可播性」语义出口。
export { classifyLength, isTrialUrlInfo } from '../shared/playability.js';
export type { LengthClass, UrlInfo } from '../shared/playability.js';
