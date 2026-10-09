import { describe, expect, it } from 'vitest';
import { normalizeUrlEncoding } from '../urlEncoding.js';

/**
 * #622：CDN 直链里的未编码 `|` 进不了 `java.net.URI`（移动端 File.downloadFileAsync
 * 直接抛转换失败）。归一的判据是「URI 合法」，不是「看起来像 URL」。
 */
describe('normalizeUrlEncoding（#622 汽水 CDN 直链）', () => {
  it('⭐ 未编码的 | 归一为 %7C（真机实测形态：query 里的 cd=0|0|0|5）', () => {
    expect(
      normalizeUrlEncoding(
        'https://v5-se-ex-alismart-luna.douyinvod.com/6aca4e50/video/tos/cn/oQ0azIPV2TCTJtQ/?a=8478&ch=0&cr=5&dr=0&cd=0|0|0|5&br=126&mime_type=audio_mp4'
      )
    ).toBe(
      'https://v5-se-ex-alismart-luna.douyinvod.com/6aca4e50/video/tos/cn/oQ0azIPV2TCTJtQ/?a=8478&ch=0&cr=5&dr=0&cd=0%7C0%7C0%7C5&br=126&mime_type=audio_mp4'
    );
  });

  it('其余 RFC 3986 排除字符同样归一（空格 / " < > ` ^ { } \\ 与控制字符）', () => {
    expect(normalizeUrlEncoding('https://cdn.example.com/a b"c<d>e`f^g{h}i\\j.mp3?x=y z&v=\u0001')).toBe(
      'https://cdn.example.com/a%20b%22c%3Cd%3Ee%60f%5Eg%7Bh%7Di%5Cj.mp3?x=y%20z&v=%01'
    );
  });

  it('裸的非 ASCII 按 UTF-8 百分号编码（同一台原生 URI 解析器也不收多字节裸字符）', () => {
    expect(normalizeUrlEncoding('https://cdn.example.com/稻香.mp3')).toBe(
      'https://cdn.example.com/%E7%A8%BB%E9%A6%99.mp3'
    );
  });

  it('已编码的转义序列一律不动（二次编码会把 CDN 签名算坏：%7C 变 %257C、%20 变 %2520）', () => {
    expect(
      normalizeUrlEncoding('https://cdn.example.com/a%7Cb.mp3?path=%2Fx%2Fy&title=%E7%A8%BB&raw=%zz')
    ).toBe('https://cdn.example.com/a%7Cb.mp3?path=%2Fx%2Fy&title=%E7%A8%BB&raw=%zz');
  });

  it('合法的 URL 逐字不变（保留 query 语义、端口与 IPv6 主机括号）', () => {
    for (const url of [
      'https://v5-se-ex-alismart-luna.douyinvod.com/6aca4e50/video/tos/cn/oQ0azIPV2TCTJtQ/?a=8478&ch=0&cr=5&cd=0%7C0%7C0%7C5&br=126#t=0,120',
      'https://v2.example.net:8443/song.aac?token=ab+cd/ef==&sig=1234~5678!-_.*()',
      'http://[::1]:8080/local.mp3?q=1',
    ]) {
      expect(normalizeUrlEncoding(url)).toBe(url);
    }
  });

  it('幂等：归一两次与一次同解（解析链与缓存各读一次不会漂）', () => {
    const raw = 'https://cdn.example.com/稻香.mp3?cd=0|0|0|5&x=a{b}c^d';
    const once = normalizeUrlEncoding(raw);
    expect(normalizeUrlEncoding(once)).toBe(once);
  });

  it('归一后的 URL 只剩 RFC 3986 允许的字符集（判据另取出处：文法的 allowed 集，与实现的排除集互补）', () => {
    const RFC3986_ALLOWED = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;
    const out = normalizeUrlEncoding('https://cdn.example.com/a b|c{d}e^f`g"h<i>j\\k\tl.mp3?cd=0|0|0|5&稻香');
    expect(out).toMatch(RFC3986_ALLOWED);
    expect(() => new URL(out)).not.toThrow();
  });

  it('空串原样返回（空 URL 是「没解析出来」，不是「需要编码」）', () => {
    expect(normalizeUrlEncoding('')).toBe('');
  });
});
