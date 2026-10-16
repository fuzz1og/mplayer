/**
 * 可播 URL 的编码归一（#622，唯一落点）：汽水 CDN 直链把 `cd=0|0|0|5` 里的 `|` **原样**吐出，JS 侧无事（WHATWG URL 允许），但 `java.net.URI` 按 RFC 3986 判非法 →
 * 移动端 `File.downloadFileAsync` 在原生层抛转换失败。**`%` 不在编码集内**（它是转义引导符，动它会把 `%7C`/`%20` 二次编码成 `%257C`/`%2520`、CDN 签名失效）——只补非法字符 ⇒ 已合法 URL 逐字不变 ⇒ 幂等。
 * **孤代理字符（#635）**：`encodeURIComponent` 对孤立代理码元抛 `URIError: URI malformed`，而畸形 URL 是数据不是逻辑——逐字符编码、拒收的字符原样放过，由下游按不可播处置。
 */

/** RFC 3986 排除字符（控制字符 / 空格 / `" < > ` ^ { } \` / 裸的非 ASCII）。 */
const ILLEGAL_URI_CHARS = /[\p{C}"<>`^{|}\\ ]|[^\0-\x7F]/gu;

/**
 * 单字符百分号编码；`encodeURIComponent` 拒收的字符（孤代理码元）原样放过。
 * 兜的是整类而不是只兜代理：上游字符串怎么畸形都不该由本函数决定怎么抛。
 */
function encodeChar(ch: string): string {
  try {
    return encodeURIComponent(ch);
  } catch {
    return ch;
  }
}

/**
 * 把 URL 补成合法 URI（`''` 原样返回——空 URL 是「没解析出来」，由调用方按既有语义处理）。
 * 非 ASCII 走 `encodeURIComponent`，于是多字节字符按 UTF-8 逐字节转义，代理对不被拆坏。
 */
export function normalizeUrlEncoding(url: string): string {
  if (!url) return url;
  return url.replace(ILLEGAL_URI_CHARS, (ch) => encodeChar(ch));
}
