import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setApiBaseUrl, musicApi, resolveCoverUrl } from '../musicApi.js';

/**
 * 上游搜索服务会话管理测试：
 * 服务端要求请求携带 PHPSESSID 会话 cookie，否则搜索返回
 * {"code":404,"error":"没有找到相关信息"}、api.php 返回「非法请求」。
 * 用本地 HTTP server 模拟服务端，验证：
 * 1. 首次请求前自动 GET 首页拿会话，搜索请求带上 Cookie；
 * 2. 会话失效（404/非法请求）时刷新会话并重试一次，调用方拿到重试结果；
 * 3. 非同源请求（第三方 CDN）不携带 Cookie。
 */

interface MockServer {
  port: number;
  close: () => Promise<void>;
}

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, log: any[]) => void
): Promise<MockServer> {
  return new Promise((resolve) => {
    const log: any[] = [];
    const server = http.createServer((req, res) => handler(req, res, log));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function sendJson(res: http.ServerResponse, obj: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const servers: MockServer[] = [];
async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, log: any[]) => void
): Promise<MockServer> {
  const s = await startServer(handler);
  servers.push(s);
  return s;
}

afterEach(async () => {
  for (const s of servers.splice(0)) {
    await s.close();
  }
});

describe('搜索服务会话管理', () => {
  it('搜索前自动获取 PHPSESSID 并带上 Cookie', async () => {
    let homeCount = 0;
    let postCookie: string | null = null;
    const s = await withServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        homeCount++;
        res.writeHead(200, { 'Set-Cookie': 'PHPSESSID=abc123; path=/' });
        res.end('<html>home</html>');
        return;
      }
      if (req.method === 'POST' && req.url === '/') {
        postCookie = req.headers.cookie || null;
        sendJson(res, {
          code: 200,
          data: [{ songid: 'Q1', name: '会话测试歌', artist: '测试歌手', url: 'api.php?get=url&type=qq&id=Q1&sign=s1&t=1' }],
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    setApiBaseUrl(`http://127.0.0.1:${s.port}/`);

    const songs = await musicApi.searchSongs('会话测试歌', 1, 'qq');

    expect(songs).toHaveLength(1);
    expect(songs[0].id).toBe('Q1');
    expect(songs[0].name).toBe('会话测试歌');
    expect(homeCount).toBe(1);
    expect(postCookie).toContain('PHPSESSID=abc123');
  });

  it('搜索返回 404「没有找到相关信息」时刷新会话并重试一次', async () => {
    let homeCount = 0;
    let postCount = 0;
    const s = await withServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        homeCount++;
        // 第一次给一个"过期"会话，刷新时给新会话
        const sid = homeCount === 1 ? 'stale1' : 'fresh2';
        res.writeHead(200, { 'Set-Cookie': `PHPSESSID=${sid}; path=/` });
        res.end('<html>home</html>');
        return;
      }
      if (req.method === 'POST' && req.url === '/') {
        postCount++;
        const cookie = req.headers.cookie || '';
        if (cookie.includes('PHPSESSID=stale1')) {
          // 会话失效：模拟服务端拒绝
          sendJson(res, { data: '', code: 404, error: '(°ー°)ノ 没有找到相关信息' });
          return;
        }
        sendJson(res, {
          code: 200,
          data: [{ songid: 'Q2', name: '重试测试歌', artist: '测试歌手', url: 'api.php?get=url&type=qq&id=Q2&sign=s2&t=1' }],
        });
      }
    });
    setApiBaseUrl(`http://127.0.0.1:${s.port}/`);

    const songs = await musicApi.searchSongs('重试测试歌', 1, 'netease');

    expect(postCount).toBe(2);
    expect(homeCount).toBe(2);
    expect(songs).toHaveLength(1);
    expect(songs[0].id).toBe('Q2');
  });

  it('api.php 返回「非法请求」时刷新会话并重试一次', async () => {
    let homeCount = 0;
    let getCount = 0;
    const s = await withServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        homeCount++;
        const sid = homeCount === 1 ? 'stale1' : 'fresh2';
        res.writeHead(200, { 'Set-Cookie': `PHPSESSID=${sid}; path=/` });
        res.end('<html>home</html>');
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/api.php')) {
        getCount++;
        const cookie = req.headers.cookie || '';
        if (cookie.includes('PHPSESSID=stale1')) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('<script>x</script>非法请求');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.end('ID3 fake audio bytes');
      }
    });
    setApiBaseUrl(`http://127.0.0.1:${s.port}/`);

    const url = await musicApi.getAudioUrl('api.php?get=url&type=qq&id=Q2&sign=s2&t=1');

    expect(getCount).toBe(2);
    expect(homeCount).toBe(2);
    expect(url).toContain('/api.php');
  });

  it('getAudioUrl 手动跟随 302 拿到 CDN 直链', async () => {
    let homeCount = 0;
    let redirectHops = 0;
    const cdn = await withServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end('ID3 cdn bytes');
    });
    const s = await withServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        homeCount++;
        res.writeHead(200, { 'Set-Cookie': 'PHPSESSID=abc123; path=/' });
        res.end('<html>home</html>');
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/api.php')) {
        redirectHops++;
        res.writeHead(302, { Location: `http://127.0.0.1:${cdn.port}/real.mp3` });
        res.end();
      }
    });
    setApiBaseUrl(`http://127.0.0.1:${s.port}/`);

    const url = await musicApi.getAudioUrl('api.php?get=url&type=qq&id=Q9&sign=s9&t=1');

    expect(redirectHops).toBe(1);
    expect(homeCount).toBe(1);
    expect(url).toBe(`http://127.0.0.1:${cdn.port}/real.mp3`);
  });

  it('非同源请求（第三方 CDN）不携带 Cookie', async () => {
    let cdnRequests = 0;
    const cdnCookies: (string | null)[] = [];
    const cdn = await withServer((req, res) => {
      cdnRequests++;
      cdnCookies.push(req.headers.cookie || null);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end('ID3 cdn bytes');
    });
    const s = await withServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Set-Cookie': 'PHPSESSID=abc123; path=/' });
        res.end('<html>home</html>');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    setApiBaseUrl(`http://127.0.0.1:${s.port}/`);

    await musicApi.getAudioUrl(`http://127.0.0.1:${cdn.port}/song.mp3`);

    expect(cdnRequests).toBeGreaterThan(0);
    for (const cookie of cdnCookies) {
      expect(cookie).toBeNull();
    }
  });

  it('resolveCoverUrl 把 api.php 封面解析成 CDN 直链并缓存', async () => {
    let picHops = 0;
    let homeCount = 0;
    const cdn = await withServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end('JPEGDATA');
    });
    const s = await withServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        homeCount++;
        res.writeHead(200, { 'Set-Cookie': 'PHPSESSID=abc123; path=/' });
        res.end('<html>home</html>');
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/api.php')) {
        picHops++;
        res.writeHead(302, { Location: `http://127.0.0.1:${cdn.port}/cover.jpg` });
        res.end();
      }
    });
    setApiBaseUrl(`http://127.0.0.1:${s.port}/`);

    const url1 = await resolveCoverUrl('api.php?get=pic&type=qq&id=Q9&sign=s9&t=1');
    const url2 = await resolveCoverUrl('api.php?get=pic&type=qq&id=Q9&sign=s9&t=1');

    expect(url1).toBe(`http://127.0.0.1:${cdn.port}/cover.jpg`);
    expect(url2).toBe(url1);
    expect(picHops).toBe(1); // 第二次命中缓存
    expect(homeCount).toBe(1);
  });

  it('resolveCoverUrl 非 api.php URL 原样返回，非法请求回退原 URL', async () => {
    expect(await resolveCoverUrl('https://p1.music.126.net/cover.jpg')).toBe('https://p1.music.126.net/cover.jpg');

    const s = await withServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Set-Cookie': 'PHPSESSID=abc123; path=/' });
        res.end('<html>home</html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<script>x</script>非法请求');
    });
    setApiBaseUrl(`http://127.0.0.1:${s.port}/`);

    const url = await resolveCoverUrl('api.php?get=pic&type=qq&id=BAD&sign=s&t=1');
    expect(url).toBe(`http://127.0.0.1:${s.port}/api.php?get=pic&type=qq&id=BAD&sign=s&t=1`);
  });
});
