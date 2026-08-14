import type { Song, AudioTag } from '../types/index.js';
import { getApiClient } from './musicApi.js';

export const PREVIEW_THRESHOLD = 1_048_576; // 1MB - 30s 128kbps ≈ 480KB, 1MB safe threshold
// 手机网络下 4s 超时会让挂起请求拖慢整批探测(批 = 最慢一首);
// 3s 折中:覆盖正常慢请求,拦截真正挂起的
export const PROBE_TIMEOUT = 3000;
export const MAX_REDIRECTS = 3;

// 探测请求头：源 CDN 防盗链校验 Referer 域名（酷狗/QQ 严格），
// 不带/带错会 403 → 直链误判失效；部分 CDN 拒非浏览器 UA。
// type 参数（wy/kg/qq/...）推断源，与 core musicApi 的 302 解析同规则。
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REFERER_BY_TYPE: Record<string, string> = {
  wy: 'https://music.163.com/',
  netease: 'https://music.163.com/',
  qq: 'https://y.qq.com/',
  kg: 'https://www.kugou.com/',
  kugou: 'https://www.kugou.com/',
  kw: 'https://www.kuwo.cn/',
  qianqian: 'https://music.qianqian.com/',
  migu: 'https://music.migu.cn/',
};

function probeRequestHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
  const m = url.match(/[?&]type=([^&]+)/);
  if (m && REFERER_BY_TYPE[m[1]]) headers['Referer'] = REFERER_BY_TYPE[m[1]];
  return headers;
}

// 会话级探测缓存:同一首歌(同 id/稳定 url)重复搜索不重复探测
// 带 TTL:过期链接探测 valid 后不能永久有效;瞬时 4xx 也不能永久标 invalid
const PROBE_CACHE_TTL = 30 * 60 * 1000;
const probeCache = new Map<string, { tag: AudioTag; expires: number }>();
const PROBE_CACHE_MAX = 500;

/**
 * 稳定缓存键:去掉 url 的时间戳参数(t=)与 soda 的 play_auth token,
 * 避免同一首歌每次搜索 url 不同导致缓存失效/堆积
 */
function probeCacheKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete('t');
    u.searchParams.delete('timestamp');
    u.searchParams.delete('play_auth');
    return u.href;
  } catch {
    return rawUrl;
  }
}

/**
 * Probe an absolute or relative audio URL and return its playability tag.
 * 全程 HEAD 跟随重定向(不下载 body),HEAD 拿不到大小(不支持/chunked)时
 * 用 Range GET 只取 1KB,完整大小从 content-range 获取。
 * 4xx/5xx 响应标记 invalid,网络异常不标记(valid)。
 */
export async function probeAudioUrl(rawUrl: string, options?: { baseUrl?: string }): Promise<AudioTag> {
  const cacheKey = probeCacheKey(rawUrl);
  const cached = probeCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.tag;

  try {
    const url = normalizeProbeUrl(rawUrl, options?.baseUrl);
    if (!url.startsWith('http')) return 'invalid';

    // 统一走共享 axios 客户端（apiClient）：探测的 api.php 端点与会话保护
    // 请求（搜索/播放直链）共用同一会话——RN 端由 OkHttp jar 携带 cookie、
    // 其他环境由拦截器显式带 Cookie 头；响应拦截器检测到「非法请求」页时
    // 自动刷新会话重试一次（无 cookie 的探测会拿到错误页，结果失真
    // ——原生 fetch 的 credentials:'include' 在 RN 实测不带 jar cookie）。
    // Range GET 只取 1KB（axios 自动跟随 302 → CDN 直链），完整大小从
    // content-range 获取；4xx/5xx 与 text/html（反爬/非法请求页）标 invalid。
    const client = getApiClient();
    const resp = await client.get(url, {
      headers: { Range: 'bytes=0-1023', ...probeRequestHeaders(url) },
      responseType: 'arraybuffer',
      timeout: PROBE_TIMEOUT,
      maxRedirects: MAX_REDIRECTS,
      validateStatus: () => true,
      __probe: true, // 跳过耗时日志与限流退避统计
    } as any);

    const status = resp.status;
    const ct = String(resp.headers['content-type'] || '');

    // 4xx/5xx 与 text/html（非法请求/反爬页，拦截器已带新会话重试过一次）：
    // 不可播。之前 fetch 探测把 142 字节错误页按 content-length 标成 preview，
    // 属于误判；统一会话后此路径只会在签名/URL 真失效时出现
    if (status >= 400 || ct.includes('text/html')) {
      probeCache.set(cacheKey, { tag: 'invalid', expires: Date.now() + PROBE_CACHE_TTL });
      return 'invalid';
    }

    let contentLength: number | null = null;
    if (status === 206) {
      const cr = String(resp.headers['content-range'] || '');
      const total = cr ? parseInt(cr.split('/')[1] || '', 10) : null;
      if (total && Number.isFinite(total)) contentLength = total;
    } else if (status < 300) {
      // 200：Range 可能被 CDN 忽略（下载完整 body，超时由 axios timeout 兜底
      // 中断 → catch → valid 不标记）；能拿到 content-length 就按大小分类
      const cl = String(resp.headers['content-length'] || '');
      if (cl) contentLength = parseInt(cl, 10);
    }

    let tag: AudioTag;
    if (contentLength === null) tag = 'valid'; // Cannot get size, don't mark
    else if (contentLength < PREVIEW_THRESHOLD) tag = 'preview';
    else tag = 'valid';

    if (probeCache.size >= PROBE_CACHE_MAX) probeCache.clear();
    probeCache.set(cacheKey, { tag, expires: Date.now() + PROBE_CACHE_TTL });
    return tag;
  } catch {
    return 'valid'; // Network errors etc. → don't mark, ensure playable
  }
}

/**
 * Probe a song URL and return its playability tag.
 */
export const SODA_PREVIEW_SECONDS = 60;

export async function probeAudio(song: Song, options?: { baseUrl?: string }): Promise<AudioTag> {
  // Soda search results have no direct URL; playback resolves it later.
  if (song.sourceType === 'soda' && !song.url) {
    return song.duration > 0 && song.duration < SODA_PREVIEW_SECONDS ? 'preview' : 'valid';
  }
  if (!song.url) return 'invalid';
  return probeAudioUrl(song.url, options);
}

export function normalizeProbeUrl(url: string, baseUrl?: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  // Relative path - use provided base URL or fallback
  const base = baseUrl || '';
  return base + url.replace(/^\//, '');
}
