import type { Song, AudioTag } from '../types/index.js';

export const PREVIEW_THRESHOLD = 1_048_576; // 1MB - 30s 128kbps ≈ 480KB, 1MB safe threshold
// 手机网络下 4s 超时会让挂起请求拖慢整批探测(批 = 最慢一首);
// 3s 折中:覆盖正常慢请求,拦截真正挂起的
export const PROBE_TIMEOUT = 3000;
export const MAX_REDIRECTS = 3;

// 会话级探测缓存:同一首歌(同 id/稳定 url)重复搜索不重复探测
const probeCache = new Map<string, AudioTag>();
const PROBE_CACHE_MAX = 500;

/**
 * 稳定缓存键:去掉 url 的时间戳参数(t=),避免同一首歌每次搜索 url 不同导致缓存失效
 */
function probeCacheKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete('t');
    u.searchParams.delete('timestamp');
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
  if (cached) return cached;

  try {
    const url = normalizeProbeUrl(rawUrl, options?.baseUrl);
    if (!url.startsWith('http')) return 'invalid';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

    // 全程 HEAD 跟随重定向(api 端点 302 → 音频直链),零 body 下载
    let finalUrl = url;
    let contentLength: number | null = null;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const resp = await fetch(finalUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });

      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
        finalUrl = new URL(resp.headers.get('location')!, finalUrl).href;
        continue;
      }

      if (resp.status < 400) {
        const cl = resp.headers.get('content-length');
        if (cl) contentLength = parseInt(cl, 10);
      }
      break;
    }

    // HEAD 拿不到大小(CDN 不支持 HEAD / chunked) → Range GET 只取 1KB
    if (contentLength === null) {
      const resp = await fetch(finalUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-1023' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (resp.status === 206) {
        const cr = resp.headers.get('content-range');
        const total = cr ? parseInt(cr.split('/')[1] || '', 10) : null;
        if (total && Number.isFinite(total)) contentLength = total;
      } else if (resp.status >= 400) {
        clearTimeout(timer);
        probeCache.set(cacheKey, 'invalid');
        return 'invalid';
      }
      // 200(Range 被忽略,会下载完整 body):abort 中断,大小未知按 valid 处理
    }

    clearTimeout(timer);

    let tag: AudioTag;
    if (contentLength === null) tag = 'valid'; // Cannot get size, don't mark
    else if (contentLength < PREVIEW_THRESHOLD) tag = 'preview';
    else tag = 'valid';

    if (probeCache.size >= PROBE_CACHE_MAX) probeCache.clear();
    probeCache.set(cacheKey, tag);
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
