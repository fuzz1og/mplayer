import CryptoJS from 'crypto-js';

/**
 * MD5 十六进制摘要（纯 JS 实现，RN 无 Node crypto 模块）。
 * 用于缓存 key 哈希——桌面端 Node 环境同样可用。
 */
export function md5(input: string): string {
  return CryptoJS.MD5(input).toString();
}
