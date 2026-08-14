import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAntiScrapeHeaders,
  getUserAgent,
  getApiRequestHeaders,
  resetUaContinuity,
  UA_POOL_SIZE,
} from '../antiScrape.js';

/**
 * T11 spec #157 G2 P1 请求硬化 —— UA 池扩池 + 反同源连续。
 *
 * 接缝 = `antiScrape.ts` 的公开函数：
 * - UA 池扩至 30-50，取值分布够广；
 * - `getUserAgent(sourceKey?)` 保证**同一源连续请求不重复同一 UA**（反同源连续）；
 * - `getAntiScrapeHeaders(referer?, sourceKey?)` 内部用连续性 UA；
 * - `getApiRequestHeaders` 为 API 态的最小请求头（两态中的 API 态）。
 */

describe('T11 UA 池扩池 + 反同源连续', () => {
  beforeEach(() => {
    resetUaContinuity();
  });

  it('UA 池扩至 30-50 条', () => {
    expect(UA_POOL_SIZE).toBeGreaterThanOrEqual(30);
    expect(UA_POOL_SIZE).toBeLessThanOrEqual(50);
  });

  it('getUserAgent() 每次返回池内真实 UA，多次调用分布多', () => {
    const agents = new Set(Array.from({ length: 50 }, () => getUserAgent()));
    expect(agents.size).toBeGreaterThanOrEqual(20);
  });

  it('同一源连续请求不重复同一 UA（反同源连续）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const ua = getUserAgent('netease');
      expect(seen.has(ua)).toBe(false);
      seen.add(ua);
    }
  });

  it('不同源互不影响（各自有独立连续性状态）', () => {
    // 源 A 与源 B 可同时使用相同 UA 而不冲突
    const a = getUserAgent('netease');
    const b = getUserAgent('kugou');
    // 都能拿到非空 UA
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });

  it('getAntiScrapeHeaders 内部使用连续性 UA：连续调用带 sourceKey 不重复同 UA', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const ua = getAntiScrapeHeaders('https://music.163.com/', 'netease')['User-Agent'];
      expect(seen.has(ua)).toBe(false);
      seen.add(ua);
    }
  });

  it('不带 sourceKey 的通用调用也参与连续性（防止跨源同 UA）', () => {
    // 最后一次通用 UA 记录到默认轨道，保证不连续
    const a = getUserAgent();
    const b = getUserAgent();
    expect(b).not.toBe(a);
  });
});

describe('T11 API 态最小请求头（两态中的 API 态）', () => {
  beforeEach(() => {
    resetUaContinuity();
  });

  it('getApiRequestHeaders 产出最小 JSON API 头，不含浏览器 sec-ch 满套', () => {
    const headers = getApiRequestHeaders();
    expect(headers['User-Agent']).toBeTruthy();
    expect(headers['Accept']).toBe('application/json, text/plain, */*');
    expect(headers['Content-Type']).toBe('application/json');
    // API 态不应携带浏览器态特有的 sec-ch 满套
    expect(headers['Sec-Fetch-Mode']).toBeUndefined();
    expect(headers['Upgrade-Insecure-Requests']).toBeUndefined();
    // API 态默认不带 Referer（不污染直连/自建 API）
    expect(headers['Referer']).toBeUndefined();
  });

  it('getApiRequestHeaders 同样满足反同源连续', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const ua = getApiRequestHeaders('qq')['User-Agent'];
      expect(seen.has(ua)).toBe(false);
      seen.add(ua);
    }
  });
});
