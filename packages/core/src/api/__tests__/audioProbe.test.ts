import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setTransport } from '../transport.js';
import { isUrlAlive } from '../audioProbe.js';

/**
 * 播放期直链活性闸测试（传输缝 mock，与直连客户端/歌词门面同一接缝）：
 * 与 probeAudioUrl 的关键语义差异——网络异常/超时按死链处理
 * （播放路径宁可重解析，不赌原生播放器对死链 ~3s 才报错）。
 */

const CDN = 'https://car-er.kuwo.cn/abc.mp3';

function transportRes(res: { status: number; headers?: Record<string, string> }) {
  return async (req: { url: string }) => ({
    status: res.status,
    headers: res.headers || {},
    body: '',
    finalUrl: req.url,
  });
}

beforeEach(() => { setTransport(null); });
afterEach(() => { setTransport(null); });

describe('isUrlAlive', () => {
  it('2xx/3xx 非 html → 活', async () => {
    setTransport(transportRes({ status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-0/1024' } }) as any);
    expect(await isUrlAlive(CDN)).toBe(true);
  });

  it('4xx/5xx → 死（签名过期/防盗链 403）', async () => {
    setTransport(transportRes({ status: 403, headers: { 'content-type': 'audio/mpeg' } }) as any);
    expect(await isUrlAlive(CDN)).toBe(false);
    setTransport(transportRes({ status: 404 }) as any);
    expect(await isUrlAlive(CDN)).toBe(false);
  });

  it('200 但 text/html（错误页/反爬页）→ 死', async () => {
    setTransport(transportRes({ status: 200, headers: { 'content-type': 'text/html' } }) as any);
    expect(await isUrlAlive(CDN)).toBe(false);
  });

  it('网络异常/超时 → 死（与 probeAudioUrl 的 valid 语义相反）', async () => {
    setTransport(async () => { throw new Error('network timeout'); });
    expect(await isUrlAlive(CDN)).toBe(false);
  });

  it('非 http 输入 → 死', async () => {
    expect(await isUrlAlive('file://local/x.mp3')).toBe(false);
    expect(await isUrlAlive('')).toBe(false);
  });
});
