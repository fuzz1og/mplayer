import axios from 'axios';
import CryptoJS from 'crypto-js';

/**
 * 网易云 weapi 加密请求(参考 NeteaseCloudMusicApi 的 weapi 算法)
 *
 * 请求体构造:
 * - params:    AES-128-CBC 双重加密(固定 presetKey → 随机 16 位 secretKey)
 * - encSecKey: secretKey 反转后 RSA 无填充(raw)加密,输出 256 位 hex
 *
 * 纯 JS 实现(crypto-js + BigInt),兼容 Node / Electron / React Native。
 * 相比官方旧接口 music.163.com/api/playlist/detail:
 * - 匿名可用,无需登录 cookie,不受 20001/404 限制
 * - 一次请求可拿全量 trackIds(n=100000),超过 1000 首的歌单也能完整获取
 */

const NETEASE_WEAPI_BASE = 'https://music.163.com/weapi';
const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const AES_IV = '0102030405060708';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// 1024 位 RSA 公钥模数(hex)
const RSA_MODULUS = BigInt(
  '0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
);
const RSA_EXPONENT = 65537n;

function aesEncrypt(text: string, key: string): string {
  return CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(key),
    { iv: CryptoJS.enc.Utf8.parse(AES_IV), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  ).toString(); // base64
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

/** RSA 无填充加密(raw),等价于 node-forge 的 encrypt(str, 'NONE'):消息左补零到 128 字节 */
function rsaRawEncrypt(text: string): string {
  // 左补零 = 消息作为整数低位,高位补零;前导零不影响整数值,无需显式移位
  let m = 0n;
  for (let i = 0; i < text.length; i++) m = (m << 8n) | BigInt(text.charCodeAt(i));
  return modPow(m, RSA_EXPONENT, RSA_MODULUS).toString(16).padStart(256, '0');
}

/**
 * 构造 weapi 请求体
 * @param secretKey 可选,注入固定 secretKey 便于测试;缺省随机生成
 */
export function weapiEncrypt(
  object: Record<string, unknown>,
  secretKey?: string
): { params: string; encSecKey: string } {
  const text = JSON.stringify(object);
  const key = secretKey ?? Array.from({ length: 16 }, () => BASE62[Math.floor(Math.random() * 62)]).join('');
  return {
    params: aesEncrypt(aesEncrypt(text, PRESET_KEY), key),
    encSecKey: rsaRawEncrypt(key.split('').reverse().join('')),
  };
}

const weapiClient = axios.create({
  headers: {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'content-type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://music.163.com/',
  },
  // 30s → 8s：网易云对无 cookie 的 weapi 请求会风控挂起（不快速拒绝），
  // 移动端歌手/歌单页批量补 URL 时 30s 超时会拖住整页加载；8s 覆盖正常
  // 慢网络，风控挂起时快速失败走搜索兜底
  timeout: 8000,
  proxy: false,
});

/** POST weapi 请求,path 形如 '/v6/playlist/detail',返回响应 JSON */
export async function weapiRequest<T>(path: string, data: Record<string, unknown>): Promise<T> {
  const res = await weapiClient.post(NETEASE_WEAPI_BASE + path, new URLSearchParams(weapiEncrypt(data)));
  return res.data as T;
}
