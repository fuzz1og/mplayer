import CryptoJS from 'crypto-js';

/**
 * **MD5 在这里是源站协议写死的算法，没有替换余地**：QQ QIMEI 签名（`qqDirect.ts`，`md5(key + params + ts*1000 + nonce + QIMEI_SECRET + extra)`）
 * 与千千签名（`qianqianDirect.ts`，`md5(sortedKv + SECRET)`）都必须与源站算法逐字节一致，换成 SHA-2 会被源站拒绝。
 * 故 CodeQL `js/weak-cryptographic-algorithm` 对本函数的告警按「源站协议要求、非本仓安全边界」显式 dismiss。
 */
export function md5(input: string): string {
  return CryptoJS.MD5(input).toString();
}
