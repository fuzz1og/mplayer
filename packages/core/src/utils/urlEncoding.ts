/**
 * 可播 URL 的编码归一（#622）。
 *
 * 汽水 CDN 直链把 `cd=0|0|0|5` 这样的参数**原样**吐出来，`|` 未编码。JS 侧一路无事
 * （WHATWG URL 允许 query 里出现它，Chromium/axios 照发），但 `java.net.URI` 按 RFC 3986
 * 解析，遇到未编码的 `|` 直接判非法字符——移动端 `File.downloadFileAsync` 于是在原生层抛
 * `The 1st argument cannot be cast to type class java.net.URI`。
 *
 * **`%` 不在编码集内**：它既是合法字符又是转义引导符，动它会把已经编码好的 `%7C`/`%20`
 * 二次编码成 `%257C`/`%2520`——CDN 签名立刻失效。于是这三条性质是同一件事：
 * 只补「非法的那几个字符」⇒ 已合法的 URL 逐字不变 ⇒ 天然幂等 ⇒ 不碰 query 里已工作的转义。
 *
 * **孤代理字符（#635）**：`encodeURIComponent` 对不在代理对里的代理码元**抛**
 * `URIError: URI malformed`。URL 是上游（CDN / 订阅源 / 分享页）吐出来的字符串，畸形是数据
 * 不是逻辑——一条畸形 URL 把解析链出口整个炸掉，正是本文件要消掉的那类失败的反面：真错该
 * 按不可播交回调用方（换源 / tier3 兜底 / 明确不可播），而不是让出口自己抛。于是逐字符编码，
 * `encodeURIComponent` 拒收的字符原样放过。三条性质一条不变（只补非法字符、已合法 URL
 * 逐字不变、幂等、不碰 `%`）；代价只是「孤代理那条畸形 URL 依旧非法」，由下游按不可播处置。
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
