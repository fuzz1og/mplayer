/**
 * 可播 URL 的编码归一（#622）。
 * **`%` 不在编码集内**：它既是合法字符又是转义引导符，动它会把已经编码好的 `%7C`/`%20`二次编码成 
 * `%257C`/`%2520`——CDN 签名立刻失效。
 */

/** RFC 3986 排除字符（控制字符 / 空格 / `" < > ` ^ { } \` / 裸的非 ASCII）。 */
const ILLEGAL_URI_CHARS = /[\p{C}"<>`^{|}\\ ]|[^\0-\x7F]/gu;

/**
 * 把 URL 补成合法 URI（`''` 原样返回——空 URL 是「没解析出来」，由调用方按既有语义处理）。
 * 非 ASCII 走 `encodeURIComponent`，于是多字节字符按 UTF-8 逐字节转义，代理对不被拆坏。
 */
export function normalizeUrlEncoding(url: string): string {
  if (!url) return url;
  return url.replace(ILLEGAL_URI_CHARS, (ch) => encodeURIComponent(ch));
}
