import type { Song, AudioTag } from '../types/index.js';

export const PREVIEW_THRESHOLD = 1_048_576; // 1MB - 30s 128kbps ≈ 480KB, 1MB safe threshold
export const PROBE_TIMEOUT = 4000;
export const MAX_REDIRECTS = 3;

/**
 * Probe an absolute or relative audio URL and return its playability tag.
 * 4xx/5xx responses are marked invalid so the UI can show a badge.
 */
export async function probeAudioUrl(rawUrl: string, options?: { baseUrl?: string }): Promise<AudioTag> {
  try {
    const url = normalizeProbeUrl(rawUrl, options?.baseUrl);
    if (!url.startsWith('http')) return 'invalid';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

    let finalUrl = url;
    let contentLength: number | null = null;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const resp = await fetch(finalUrl, {
        method: i === 0 ? 'HEAD' : 'GET',
        signal: controller.signal,
        redirect: 'manual',
      });

      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
        finalUrl = new URL(resp.headers.get('location')!, finalUrl).href;
        continue;
      }

      if (resp.status >= 400) {
        // HEAD is not always supported; retry once with GET, otherwise mark invalid.
        if (i === 0) continue;
        clearTimeout(timer);
        return 'invalid';
      }

      const cl = resp.headers.get('content-length');
      contentLength = cl ? parseInt(cl, 10) : null;
      break;
    }

    clearTimeout(timer);

    if (contentLength === null) return 'valid'; // Cannot get size, don't mark
    if (contentLength < PREVIEW_THRESHOLD) return 'preview';
    return 'valid';
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
  const base = baseUrl || 'http://www.jbsou.cn/';
  return base + url.replace(/^\//, '');
}
