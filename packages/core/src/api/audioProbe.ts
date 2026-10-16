import { request } from './transport.js';
import { URL_ALIVE_PROBE_TIMEOUT_MS } from '../shared/playbackBudgets.js';

// 活性闸请求头：带浏览器 UA + 按源推导的官方 Referer。
// ⚠️ **不要把「不带/带错 Referer 会 403」当事实**——那句话是无出处的注释，撑过 #592/#602 的
// 全部风险讨论；2026-10-16 五臂实测（无头/对源/空串/跨源/假 API 域）在 9 个真实 URL 上
// 45 次请求全部 200 且字节一致，即该前提**未被证实**（#647、ADR 2026-10-08 §真机取证）。
// 保留这份头的理由是「无害且可能覆盖未测到的档位」，不是「已证有必要」。
// UA 与按源 Referer 映射见 utils/sourceReferer.ts（core 共享，与 musicApi/播放器同一份）。
import { BROWSER_UA, refererForUrl } from '../utils/sourceReferer.js';

function probeRequestHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
  const referer = refererForUrl(url);
  if (referer) headers['Referer'] = referer;
  return headers;
}

/**
 * 播放期直链活性闸的 Range GET：统一走传输层（与直连客户端/歌词门面同一传输接缝，
 * 默认 axios 实现，重试/超时行为一致；302 由 axios 自动跟随到 CDN 直链），
 * 并带浏览器 UA + 按源推导的 Referer（无害；是否必要见文件头 ⚠️ 与 #647）。
 * 网络异常直接上抛——极性由调用方定义。
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
 * 网络异常/超时按**死链**处理（宁可多花一次 fresh 重解析，不赌原生播放器对死链
 * ~3s 才报 Source error）；**不写任何缓存**（活性结论时效极短，复用会误判）。
 *
 * #391：批量可播性探测（probeAudioUrl/probeAudio）已删除——判据反向（把「直连拿不到
 * URL」判成失效，而多数歌靠 tier3 才可播）且产物无消费者；本模块只保留这条活性闸。
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
