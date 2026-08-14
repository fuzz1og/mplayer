import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const cacheDir = vi.hoisted(() => `${process.cwd()}/.cache-ipc-test-${Date.now()}`);

vi.mock('electron', () => ({
  app: { getPath: () => cacheDir },
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import { registerCacheIpc } from '../../main/ipc/cache';

type Handler = (...args: any[]) => any;

function getHandler(channel: string): Handler {
  const call = (ipcMain.handle as any).mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`IPC handler not registered: ${channel}`);
  return call[1];
}

describe('registerCacheIpc legacy binary channels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerCacheIpc();
  });

  afterAll(() => {
    const resolved = path.resolve(cacheDir);
    const root = path.resolve(process.cwd());
    if (resolved.startsWith(root + path.sep)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  it('returns a disk file path after caching a cover', async () => {
    const setCover = getHandler('cache:setCover');
    const getCover = getHandler('cache:getCover');

    // 有效 PNG 头
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    await setCover({}, 'https://example.com/cover.jpg', png);

    const cachedPath = await getCover({}, 'https://example.com/cover.jpg');
    expect(typeof cachedPath).toBe('string');
    expect(fs.existsSync(cachedPath as string)).toBe(true);
  });

  it('deletes a corrupt cached cover and returns null (triggers re-fetch)', async () => {
    const setCover = getHandler('cache:setCover');
    const getCover = getHandler('cache:getCover');

    // 非图片内容（错误页/默认图）不视为有效封面
    await setCover({}, 'https://example.com/broken.jpg', Buffer.from('<html>error</html>'));

    const cachedPath = await getCover({}, 'https://example.com/broken.jpg');
    expect(cachedPath).toBeNull();
  });

  it('returns null when the cover is not cached', async () => {
    const getCover = getHandler('cache:getCover');
    expect(await getCover({}, 'https://example.com/missing.jpg')).toBeNull();
  });

  it('expires URL cache after ttlMs (kernel TTL actually enforced)', async () => {
    const setJSON = getHandler('cache:setJSON');
    const getJSON = getHandler('cache:getJSON');

    // TTL 余量放宽：并行测试负载下 20ms 会过期在读写之间（时序 flake）
    await setJSON({}, 'url:expire-test', { url: 'https://example.com/x.mp3' }, 200);
    expect(await getJSON({}, 'url:expire-test')).toEqual({ url: 'https://example.com/x.mp3' });
    await new Promise((r) => setTimeout(r, 400));
    expect(await getJSON({}, 'url:expire-test')).toBeNull();
  });

  it('treats legacy json entries (no expiry metadata) as expired and deletes them', async () => {
    const getJSON = getHandler('cache:getJSON');
    // 模拟缓存统一重构前写入的旧格式条目：json 数据文件 + 无 expiresAt 的 meta
    const key = ':json:url:legacy123';
    const md5 = crypto.createHash('md5').update(key).digest('hex');
    const dataDir = path.join(cacheDir, 'cache', 'bin');
    const metaDir = path.join(cacheDir, 'cache', 'meta');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, md5), JSON.stringify({ url: 'https://expired.example.com/a.mp3' }));
    fs.writeFileSync(path.join(metaDir, `${md5}.json`), JSON.stringify({ key, size: 50 }));

    expect(await getJSON({}, 'url:legacy123')).toBeNull();
    expect(fs.existsSync(path.join(dataDir, md5))).toBe(false);
  });
});
