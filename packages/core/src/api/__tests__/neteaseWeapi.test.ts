import { describe, it, expect } from 'vitest';
import { weapiEncrypt } from '../neteaseWeapi.js';

// 参考向量由 node:crypto(官方 AES-128-CBC / RSA_NO_PADDING)计算,交叉验证 BigInt + crypto-js 实现
const FIXED_SECRET = 'aB3dE5gH7jL9nP1r';
const REFERENCE = {
  object: { id: 3778678, n: 100000, s: 8 },
  params: 'diFL+Rf4Fx2PLuGXsKOe6MfRPG2DZzod66eZ2fXzROO3YVmp9qv/3pGkyyrR4rSp',
  encSecKey: '256e65038864a774050e19d670bc7f996b8a3679aa2c11d3fb8f00bcc5223ec9143b9122291aef5507df23bbab5002900140aa435bce0b9469f81bdc3aaf120673e82b48e76cbbde4418c358156122c83781021d2c388961abfd0d7eee51dae5965a62857cc09c35a6a72a4072bd2c9034aea42108e004f34f1a94567d8f79df',
};

describe('weapiEncrypt', () => {
  it('固定 secretKey 时输出与 node:crypto 参考向量一致', () => {
    const { params, encSecKey } = weapiEncrypt(REFERENCE.object, FIXED_SECRET);
    expect(params).toBe(REFERENCE.params);
    expect(encSecKey).toBe(REFERENCE.encSecKey);
  });

  it('默认随机生成 secretKey,params 为 base64、encSecKey 为 256 位 hex', () => {
    const { params, encSecKey } = weapiEncrypt({ id: 3778678 });
    expect(params).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(encSecKey).toMatch(/^[0-9a-f]{256}$/);
  });

  it('两次调用结果不同(随机 secretKey)', () => {
    const a = weapiEncrypt({ id: 3778678 });
    const b = weapiEncrypt({ id: 3778678 });
    expect(a).not.toEqual(b);
  });
});
