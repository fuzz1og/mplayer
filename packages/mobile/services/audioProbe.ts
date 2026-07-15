import type { Song, AudioTag } from '@mplayer/core';

const PREVIEW_THRESHOLD = 1_048_576; // 1MB — 30s 128kbps ≈ 480KB, 1MB 安全阈值
const PROBE_TIMEOUT = 5000;
const MAX_REDIRECTS = 3;

/**
 * HEAD 请求探测音频文件 Content-Length，判断是否可播放以及是否为试听片段。
 * 失败时返回 `'valid'` — 宁可误放也不误拦。
 */
export async function probeAudio(song: Song): Promise<AudioTag> {
  if (!song.url) return 'invalid';

  try {
    // 构造完整 URL
    const url = normalizeProbeUrl(song.url);
    if (!url.startsWith('http')) return 'invalid';

    // 跟随重定向，HEAD 探测
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

    let finalUrl = url;
    let contentLength: number | null = null;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const resp = await fetch(finalUrl, {
        method: i === MAX_REDIRECTS ? 'HEAD' : 'GET',
        signal: controller.signal,
        redirect: 'manual',
      });

      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
        finalUrl = new URL(resp.headers.get('location')!, finalUrl).href;
        continue;
      }

      if (resp.status >= 400) {
        clearTimeout(timer);
        return 'invalid';
      }

      // 成功响应
      const cl = resp.headers.get('content-length');
      contentLength = cl ? parseInt(cl, 10) : null;
      break;
    }

    clearTimeout(timer);

    if (contentLength === null) return 'valid'; // 无法获取大小，不标记
    if (contentLength < PREVIEW_THRESHOLD) return 'preview';
    return 'valid';
  } catch {
    return 'valid'; // 网络错误等 → 不标记，保证可播放
  }
}

function normalizeProbeUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  // 相对路径 — 用当前 API base URL
  return 'http://www.thirdparty.cn/' + url.replace(/^\//, '');
}
