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
 * **「每源播放/下载请求头」的唯一事实来源**（#592）。
 *
 * 为什么必须有单点：`BROWSER_UA` 与 `REFERER_BY_SOURCE` 都是本文件的私有事实。
 * #592 之前，移动端 `audioPlayer.ts`（expo-audio 路径）、`downloadService.ts`（内嵌封面）
 * 各自手拼一份，而 `nativePlayer.ts` 的 `headersFor` 是个恒 `undefined` 的空壳
 * → **Android 主引擎（media3）这条路上每源请求头实际没被应用**，原生
 * `ExpiryGuard.withRequestHeaders` 因此空转。拼装点一多，「源表加了新源」这种事
 * 就只会修到其中几处。
 *
 * 语义（调用方不要再叠加、也不要改写）：
 * - `User-Agent` 恒为 [BROWSER_UA]：部分 CDN 拒非浏览器 UA。
 * - `Referer` **按 `Song.sourceType`（netease/kugou/...）** 取官方站点域名；源表同时
 *   兼容 `api.php` 的 type 形状（`wy`/`kg`），两种 key 都能命中。
 * - **未知源 / `soda` / `local` / 缺省一律不带 `Referer`**——没有可冒用的官方域名时
 *   宁可不带头：空字符串 `Referer` 是「带错头」，比不带更容易被防盗链拒。
 *
 * 刻意不归入本函数的两类调用点（语义不同，别顺手改）：
 * - `audioProbe.ts` 的活性闸 / `musicApi.ts` 的歌词请求：Referer 由 **URL** 推导
 *   （`refererForUrl`，含 QQ 歌词页 / 酷狗 / 酷我歌词端点这类按 URL 的特例），
 *   与「按源」不是同一回事。
 * - 各源 API 客户端（`qqDirect`/`neteaseDirect`/`antiScrape` 等）自己的请求头：
 *   那是**接口调用**头（含 UA 轮换、签名、Cookie），不是播放/下载头。
 *
 * 每次返回**新对象**：调用方可以安全地摊开或改写，不会污染源表。
 */
export function requestHeadersFor(source?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
  const referer = source ? REFERER_BY_SOURCE[source] : undefined;
  if (referer) headers.Referer = referer;
  return headers;
}
