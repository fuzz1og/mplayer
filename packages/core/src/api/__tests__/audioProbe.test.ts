import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setApiRequestHandler } from '../musicApi.js';
import { isUrlAlive } from '../audioProbe.js';

/**
 * 播放期直链活性闸测试（桥接缝 mock apiClient）：
 * 与 probeAudioUrl 的关键语义差异——网络异常/超时按死链处理
 * （播放路径宁可重解析，不赌原生播放器对死链 ~3s 才报错）。
 */

const CDN = 'https://car-er.kuwo.cn/abc.mp3';

beforeEach(() => { setApiRequestHandler(null); });
afterEach(() => { setApiRequestHandler(null); });

describe('isUrlAlive', () => {
  it('2xx/3xx 非 html → 活', async () => {
    setApiRequestHandler(async () => ({
      status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-0/1024' },
      text: '', finalUrl: CDN,
    }));
    expect(await isUrlAlive(CDN)).toBe(true);
  });

  it('4xx/5xx → 死（签名过期/防盗链 403）', async () => {
    setApiRequestHandler(async () => ({ status: 403, headers: { 'content-type': 'audio/mpeg' }, text: '', finalUrl: CDN }));
    expect(await isUrlAlive(CDN)).toBe(false);
    setApiRequestHandler(async () => ({ status: 404, headers: {}, text: '', finalUrl: CDN }));
    expect(await isUrlAlive(CDN)).toBe(false);
  });

  it('200 但 text/html（错误页/反爬页）→ 死', async () => {
    setApiRequestHandler(async () => ({ status: 200, headers: { 'content-type': 'text/html' }, text: '<html/>', finalUrl: CDN }));
    expect(await isUrlAlive(CDN)).toBe(false);
  });

  it('网络异常/超时 → 死（与 probeAudioUrl 的 valid 语义相反）', async () => {
    setApiRequestHandler(async () => { throw new Error('network timeout'); });
    expect(await isUrlAlive(CDN)).toBe(false);
  });

  it('非 http 输入 → 死', async () => {
    expect(await isUrlAlive('file://local/x.mp3')).toBe(false);
    expect(await isUrlAlive('')).toBe(false);
  });
});
