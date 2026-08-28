import axios from 'axios';

/**
 * 歌单分享短链解析（主进程独有，#274）：
 * 渲染层受 CORS 限制无法跟随跨域 302，短链（163cn.tv/*）→ 歌单落地页的
 * 重定向解析必须在主进程完成。逐跳跟随 3xx Location，返回最终落地 URL；
 * 歌单 id 由渲染层用 parsePlaylistUrl 对落地 URL 再解析。
 */

const MAX_REDIRECT_HOPS = 5;
const TIMEOUT_MS = 15000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

/** 允许解析的入口域名（parsePlaylistUrl 的 netease-short 命中域；防被当作通用重定向跟随器滥用） */
const ALLOWED_HOSTS = ['163cn.tv', 'music.163.com'];

/**
 * 解析歌单分享短链：跟随 302 重定向，返回最终落地 URL（含歌单 id 参数）。
 * 非 3xx 响应视为已到达落地页；重定向次数超限抛错。
 */
export async function resolvePlaylistLink(url: string): Promise<string> {
  const parsed = new URL(url);
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      !ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
    throw new Error('不支持的歌单链接域名');
  }

  let current = parsed.toString();
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const resp = await axios.get(current, {
      maxRedirects: 0,
      validateStatus: () => true, // 3xx 也要拿到 Location 自行跟跳
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
    });
    const location = resp.headers.location;
    if (resp.status >= 300 && resp.status < 400 && typeof location === 'string' && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return current;
  }
  throw new Error('短链重定向次数过多');
}
