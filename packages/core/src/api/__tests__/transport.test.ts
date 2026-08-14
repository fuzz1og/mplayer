import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTransport, request, type TransportRequest } from '../transport.js';

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
