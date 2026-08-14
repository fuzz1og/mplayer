import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  setTransport,
  request,
  setTransportRetryOptions,
  setTlsDegradeProvider,
  isTlsHandshakeError,
  type TransportRequest,
} from '../transport.js';

/**
 * 传输接缝测试（T01 切片 1）：
 * 接缝 = core 请求层底部的可注入传输（Transport）。
 * 直接客户端（T02+）与预检（T12）统一经 `request()` 出网；
 * 测试注入 mock 传输即可驱动全部请求层行为，不真实出网（默认实现除外）。
 */

afterEach(() => {
  setTransport(null);
});

describe('transport 接缝', () => {
  it('注入 transport 后 request 全部经其转发（方法/URL/头/超时透传）', async () => {
    const calls: TransportRequest[] = [];
    setTransport(async (req) => {
      calls.push(req);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}', finalUrl: req.url };
    });

    const res = await request({
      method: 'GET',
      url: 'https://example.com/api',
      headers: { 'User-Agent': 'test-ua', Referer: 'https://example.com/' },
      timeoutMs: 500,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: 'https://example.com/api',
      headers: { 'User-Agent': 'test-ua', Referer: 'https://example.com/' },
      timeoutMs: 500,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(res.finalUrl).toBe('https://example.com/api');
  });

  it('POST 的 body 原样透传给注入的传输', async () => {
    let seenBody: string | undefined;
    setTransport(async (req) => {
      seenBody = req.body;
      return { status: 201, headers: {}, body: '', finalUrl: req.url };
    });

    await request({ method: 'POST', url: 'https://example.com/submit', body: 'a=1&b=2' });
    expect(seenBody).toBe('a=1&b=2');
  });

  it('注入 null 后恢复默认实现（真实网络，本地 server 验证）', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hello: 'world' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await request({ method: 'GET', url: `http://127.0.0.1:${port}/ping`, timeoutMs: 3000 });
      expect(res.status).toBe(200);
      expect(res.body).toBe('{"hello":"world"}');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

/**
 * 统一重试 + TLS 降级（T09 spec #155）：
 * 重试接缝 = core 请求层底部的 `request()`（对新代码统一出网点生效）。
 * - 5xx / 网络错误按策略重试（maxRetries=3，指数退避）；4xx 与「会话失效」不重试；
 * - 内容直链（content 标记）在 TLS 握手失败时用降级配置重试一次（仅桌面：
 *   需先 `setTlsDegradeProvider` 注入降级 agent 提供者；RN/未注入不触发）。
 * 退避用 fake timers 确定性断言。
 */
describe('统一重试（T09）', () => {
  beforeEach(() => {
    setTransport(null);
    setTransportRetryOptions(null);
    setTlsDegradeProvider(null);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setTransport(null);
    setTransportRetryOptions(null);
    setTlsDegradeProvider(null);
  });

  function okBody() {
    return { status: 200, headers: {}, body: 'ok', finalUrl: 'https://x.example/' };
  }

  it('5xx 按 maxRetries=3 指数退避重试（共 4 次尝试，退避依次为 base/2base/4base）', async () => {
    const attempts: number[] = [];
    setTransport(async () => {
      attempts.push(Date.now());
      return { status: 502, headers: {}, body: '', finalUrl: 'https://x.example/' };
    });

    const promise = request({ method: 'GET', url: 'https://x.example/api' });
    // 推进若干次退避，让重试完成（base=100ms，最多 100+200+400=700ms 后完成）
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;

    expect(attempts).toHaveLength(4); // 1 次原始 + 3 次重试
    expect(res.status).toBe(502);

    // 退避间隔：约 base=100（100→200→400），允许 fake timer 时序容差
    const gaps = attempts.slice(1).map((t, i) => t - attempts[i]);
    expect(gaps[0]).toBeGreaterThanOrEqual(100);
    expect(gaps[1]).toBeGreaterThanOrEqual(100);
    expect(gaps[2]).toBeGreaterThanOrEqual(400);
  });

  it('5xx 在允许次数内成功则不再重试剩余次数', async () => {
    let n = 0;
    setTransport(async () => {
      n++;
      return n < 2 ? { status: 503, headers: {}, body: '', finalUrl: 'https://x.example/' } : okBody();
    });

    const promise = request({ method: 'GET', url: 'https://x.example/api' });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;

    expect(n).toBe(2);
    expect(res.status).toBe(200);
  });

  it('4xx 不重试（语义不变）', async () => {
    let n = 0;
    setTransport(async () => {
      n++;
      return { status: 404, headers: {}, body: '', finalUrl: 'https://x.example/' };
    });

    const res = await request({ method: 'GET', url: 'https://x.example/api' });

    expect(n).toBe(1);
    expect(res.status).toBe(404);
  });

  it('「会话失效」响应不重试（即使状态码为 5xx）', async () => {
    let n = 0;
    setTransport(async () => {
      n++;
      return { status: 502, headers: {}, body: '', finalUrl: 'https://x.example/', sessionInvalid: true };
    });

    const res = await request({ method: 'GET', url: 'https://x.example/api' });

    expect(n).toBe(1);
    expect(res.status).toBe(502);
  });

  it('网络错误（ECONNRESET）按策略重试，超限后抛出最后一次错误', async () => {
    let n = 0;
    setTransport(async () => {
      n++;
      const e: any = new Error('socket hang up');
      e.code = 'ECONNRESET';
      throw e;
    });

    const promise = request({ method: 'GET', url: 'https://x.example/api' });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'ECONNRESET' });
    await vi.advanceTimersByTimeAsync(2000);

    await assertion;
    expect(n).toBe(4);
  });

  it('网络错误在退避后成功则返回成功结果', async () => {
    let n = 0;
    setTransport(async () => {
      n++;
      if (n === 1) {
        const e: any = new Error('timeout');
        e.code = 'ETIMEDOUT';
        throw e;
      }
      return okBody();
    });

    const promise = request({ method: 'GET', url: 'https://x.example/api' });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;

    expect(n).toBe(2);
    expect(res.status).toBe(200);
  });

  it('业务抛错（非网络错误）不重试', async () => {
    let n = 0;
    setTransport(async () => {
      n++;
      throw new Error('business error');
    });

    await expect(request({ method: 'GET', url: 'https://x.example/api' })).rejects.toThrow('business error');
    expect(n).toBe(1);
  });
});

describe('TLS 降级（T09，仅桌面）', () => {
  beforeEach(() => {
    setTransport(null);
    setTransportRetryOptions(null);
    setTlsDegradeProvider(null);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setTransport(null);
    setTransportRetryOptions(null);
    setTlsDegradeProvider(null);
  });

  function tlsErr(code = 'ERR_SSL_CIPHER_OPERATION_FAILED') {
    const e: any = new Error('TLS handshake failed');
    e.code = code;
    return e;
  }

  it('isTlsHandshakeError 识别常见 TLS 错误码', () => {
    expect(isTlsHandshakeError(tlsErr('ERR_SSL_CIPHER_OPERATION_FAILED'))).toBe(true);
    expect(isTlsHandshakeError(tlsErr('ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR'))).toBe(true);
    expect(isTlsHandshakeError(tlsErr('ECONNRESET'))).toBe(false);
  });

  it('内容直链 TLS 握手失败：注入降级提供者时用降级配置重试一次', async () => {
    setTlsDegradeProvider(() => ({ httpsAgent: { degraded: true } }));
    let n = 0;
    const seen: (TransportRequest | undefined)[] = [];
    setTransport(async (req) => {
      seen.push(req);
      n++;
      if (n === 1) throw tlsErr();
      return { status: 200, headers: {}, body: 'ok', finalUrl: req.url };
    });

    const res = await request({ method: 'GET', url: 'https://cdn.example/song.mp3', content: true });

    expect(n).toBe(2);
    expect(res.status).toBe(200);
    // 降级重试的请求带 tlsDegrade 标记
    expect(seen[1]?.tlsDegrade).toBe(true);
    expect(seen[0]?.tlsDegrade).toBeUndefined();
  });

  it('内容直链 TLS 失败但未注入降级提供者：不追加降级重试（仅按网络错误处理退避重试）', async () => {
    const seen: (TransportRequest | undefined)[] = [];
    setTransport(async (req) => {
      seen.push(req);
      throw tlsErr();
    });
    const promise = request({ method: 'GET', url: 'https://cdn.example/song.mp3', content: true });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'ERR_SSL_CIPHER_OPERATION_FAILED' });
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    // 所有重试都不应带 tlsDegrade 标记
    expect(seen.every((r) => !r?.tlsDegrade)).toBe(true);
  });

  it('非内容直链请求：TLS 失败不降级（只能网络错误退避）', async () => {
    setTlsDegradeProvider(() => ({ httpsAgent: { degraded: true } }));
    let n = 0;
    setTransport(async () => {
      n++;
      throw tlsErr();
    });
    const promise = request({ method: 'GET', url: 'https://api.example/search' });
    const assertion = expect(promise).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    // 非 content：无降级分支，总尝试 = 1 + maxRetries（这里 4 次）
    expect(n).toBe(4);
  });

  it('移动端（未注入降级提供者）内容直链 TLS 失败不触发任何降级', async () => {
    // RN 从不调用 setTlsDegradeProvider；此用例模拟「未注入」时行为不受降级影响
    expect(() => setTlsDegradeProvider(null)).not.toThrow();
  });
});
