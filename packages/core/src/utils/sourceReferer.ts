/**
 * 浏览器 UA 与「源 → 官方站点 Referer」映射（core 共享）：302 解析、音频探测、播放器请求都带浏览器 UA + 按源推导的官方 Referer。
 * ⚠️ 本文件原先的「源 CDN 防盗链校验 Referer 域名」**无出处**，却撑起了 #592 立项与 ADR `2026-10-08` 的全部风险讨论；2026-10-16 五臂实测（无头/对源/空串/跨源/假 API 域）
 * 在 9 个真实 URL 上 45 次请求**全部 200 且字节一致**——该前提**未被证实**（#647）。口径：带这份头是无害的，不是「不带就 403」。
 */

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 同一张表同时按 api.php type 参数（wy/kg/...）与 SourceKey（netease/kugou/...）检索
const REFERER_BY_SOURCE: Record<string, string> = {
  wy: 'https://music.163.com/',
  netease: 'https://music.163.com/',
  qq: 'https://y.qq.com/',
  kg: 'https://www.kugou.com/',
  kugou: 'https://www.kugou.com/',
  kw: 'https://www.kuwo.cn/',
  kuwo: 'https://www.kuwo.cn/',
  qianqian: 'https://music.qianqian.com/',
  migu: 'https://music.migu.cn/',
};

/** 按 api.php URL 的 type 参数取 Referer（302 解析/探测用） */
export function refererForApiType(apiType?: string): string | undefined {
  return apiType ? REFERER_BY_SOURCE[apiType] : undefined;
}

/** 从 URL 中提取 type 参数（wy/kg/qq/...）并返回对应 Referer；同时识别各源直连歌词端点。 */
export function refererForUrl(url: string): string | undefined {
  try {
    // QQ 歌词 fcg 需要播放器页 Referer，否则 CDN 防盗链会拦截（prototype/r1 实测口径）。
    if (/c\.y\.qq\.com\/lyric\//i.test(url)) {
      return 'https://y.qq.com/portal/player.html';
    }
    // 酷我/酷狗歌词直连同样按官方站点 Referer 处理，避免空响应/403。
    if (/newlyric\.kuwo\.cn/i.test(url)) return 'https://www.kuwo.cn/';
    if (/lyrics\.kugou\.com/i.test(url)) return 'https://www.kugou.com/';

    const m = url.match(/[?&]type=([^&]+)/);
    return m ? REFERER_BY_SOURCE[m[1]] : undefined;
  } catch {
    return undefined;
  }
}

/** 按 Song.sourceType（netease/kugou/...）取 Referer（播放器请求头用） */
export function refererForSourceKey(sourceKey: string): string | undefined {
  return REFERER_BY_SOURCE[sourceKey];
}

/**
 * **「每源播放/下载请求头」的唯一事实来源**（#592 结构半）：`BROWSER_UA` 与 `REFERER_BY_SOURCE` 都是本文件私有事实，拼装动作此前散在各宿主（移动端 `audioPlayer`/`downloadService`、core `directValidation`），
 * 拼装点一多「源表加了新源」就只会修到其中几处。Android 原生主引擎也已接本单点（#602/#634 已真机取证，见 ADR `2026-10-08` 的边界）。
 * 语义：`User-Agent` 恒为 [BROWSER_UA]；`Referer` 按 `Song.sourceType` 取官方域名；**未知源 / `soda` / `local` / 缺省一律不带 `Referer`**（空字符串是「带错头」）。每次返回**新对象**，调用方可安全改写。
 */
export function requestHeadersFor(source?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
  const referer = source ? REFERER_BY_SOURCE[source] : undefined;
  if (referer) headers.Referer = referer;
  return headers;
}
