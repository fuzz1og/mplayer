/**
 * 浏览器 UA 与「源 → 官方站点 Referer」映射（core 共享）。
 *
 * 源 CDN 防盗链校验 Referer 域名（酷狗/QQ 严格，网易云宽松）：
 * 302 解析、音频探测、播放器请求都要带官方 Referer 才会被 CDN 接受。
 * 统一放 core，避免 musicApi / audioProbe / 播放器三处各自复制、
 * 且 key 形状不一致（api.php type 参数 wy/kg 与 Song.sourceType
 * netease/kugou 混用）导致漏配。
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

/** 从 URL 中提取 type 参数（wy/kg/qq/...）并返回对应 Referer */
export function refererForUrl(url: string): string | undefined {
  try {
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
