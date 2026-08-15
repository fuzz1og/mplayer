/**
 * base64 → UTF-8 解码单点（双端共用，无 node 专属 API）。
 *
 * 源站歌词/内容常见 base64 载荷（QQ fcg lyric、酷狗 download content 等），
 * 此前 musicApi 与 kugouDirect 各有实现，收敛到此处单一事实来源。
 * atob（浏览器/RN）返回 Latin-1 二进制串 → 转字节 → UTF-8 解码；
 * Node 兜底 Buffer。解码失败返回 ''（调用方兜底，不炸链路）。
 */

export function decodeBase64Utf8(input: string): string {
  const clean = input.replace(/\s+/g, '');
  if (!clean) return '';
  try {
    if (typeof atob === 'function') {
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    // Node 兜底
    return Buffer.from(clean, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}
