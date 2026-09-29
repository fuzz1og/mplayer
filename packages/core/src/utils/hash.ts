import CryptoJS from 'crypto-js';

/**
 * MD5 十六进制摘要（纯 JS 实现，RN 无 Node crypto 模块；桌面端 Node 环境同样可用）。
 *
 * **MD5 在这里是源站协议写死的算法，没有替换余地**：QQ QIMEI 签名
 * （`qqDirect.ts`，`md5(key + params + ts*1000 + nonce + QIMEI_SECRET + extra)`）
 * 与千千签名（`qianqianDirect.ts`，`md5(sortedKv + SECRET)`）都必须与源站算法
 * 逐字节一致，换成 SHA-2 会被源站拒绝。其余调用点只把它当「短哈希」用于缓存 key
 * 与下载文件名（非完整性/认证用途）。
 *
 * 因此 CodeQL `js/weak-cryptographic-algorithm` 对本函数的告警按「源站协议要求、
 * 不构成本仓库的安全边界」显式 dismiss，而不是替换算法。
 */
export function md5(input: string): string {
  return CryptoJS.MD5(input).toString();
}
