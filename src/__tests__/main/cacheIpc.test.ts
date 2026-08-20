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
import { resourceUrlKey } from '@mplayer/core';

type Handler = (...args: any[]) => any;

function getHandler(channel: string): Handler {
  const call = (ipcMain.handle as any).mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`IPC handler not registered: ${channel}`);
  return call[1];
}

describe('registerCacheIpc 语义缓存通道（ADR-0002）', () => {
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

  it('僵尸通道已删除：getSong/setSong/getAudio/setAudio + typed getJSON/setJSON/getBinary/setBinary 未注册', () => {
    const registered = (ipcMain.handle as any).mock.calls.map((c: any[]) => c[0]);
    const zombies = ['cache:getSong','cache:setSong','cache:getAudio','cache:setAudio','cache:getJSON','cache:setJSON','cache:getBinary','cache:setBinary'];
    for (const z of zombies) {
      expect(registered).not.toContain(z);
    }
    // 7 个语义通道全部注册
    const semantics = ['cache:getSongResources','cache:setSongResources','cache:getCoverPath','cache:setCoverBytes','cache:invalidateCover','cache:clear','cache:getStats'];
    for (const s of semantics) {
      expect(registered).toContain(s);
    }
  });

  it('三元组 round-trip：setSongResources 后 getSongResources 读回（走内核语义 key）', async () => {
    const set = getHandler('cache:setSongResources');
    const get = getHandler('cache:getSongResources');

    const resources = { url: 'https://example.com/song.mp3', cover: 'https://example.com/c.jpg', lrc: 'https://example.com/l.lrc' };
    await set({}, 'netease:1', resources);
    expect(await get({}, 'netease:1')).toEqual(resources);
    expect(await get({}, 'netease:other')).toBeNull();
  });

  it('setCoverBytes 写入有效 PNG 后 getCoverPath 返回存在的磁盘 file 路径', async () => {
    const setCover = getHandler('cache:setCoverBytes');
    const getCover = getHandler('cache:getCoverPath');

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    await setCover({}, 'https://example.com/cover.jpg', png);

    const cachedPath = await getCover({}, 'https://example.com/cover.jpg');
    expect(typeof cachedPath).toBe('string');
    expect(fs.existsSync(cachedPath as string)).toBe(true);
  });

  it('非图片封面字节（默认图/错误页）由语义层 setCoverBytes 拒绝，getCoverPath 返回 null', async () => {
    const setCover = getHandler('cache:setCoverBytes');
    const getCover = getHandler('cache:getCoverPath');

    await setCover({}, 'https://example.com/broken.jpg', Buffer.from('<html>error</html>'));

    const cachedPath = await getCover({}, 'https://example.com/broken.jpg');
    expect(cachedPath).toBeNull();
  });

  it('返回 null when the cover is not cached', async () => {
    const getCover = getHandler('cache:getCoverPath');
    expect(await getCover({}, 'https://example.com/missing.jpg')).toBeNull();
  });

  it('invalidateCover 清除后 getCoverPath 返回 null', async () => {
    const setCover = getHandler('cache:setCoverBytes');
    const getCover = getHandler('cache:getCoverPath');
    const invalidate = getHandler('cache:invalidateCover');

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await setCover({}, 'https://example.com/inv.jpg', png);
    expect(await getCover({}, 'https://example.com/inv.jpg')).not.toBeNull();

    await invalidate({}, 'https://example.com/inv.jpg');
    expect(await getCover({}, 'https://example.com/inv.jpg')).toBeNull();
  });

  it('clear 清空歌曲资源与封面缓存', async () => {
    const setSong = getHandler('cache:setSongResources');
    const setCover = getHandler('cache:setCoverBytes');
    const getSong = getHandler('cache:getSongResources');
    const getCover = getHandler('cache:getCoverPath');
    const clear = getHandler('cache:clear');

    await setSong({}, 'x', { url: 'u', cover: 'c', lrc: 'l' });
    await setCover({}, 'https://example.com/clear.jpg', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await clear({});
    expect(await getSong({}, 'x')).toBeNull();
    expect(await getCover({}, 'https://example.com/clear.jpg')).toBeNull();
  });

  it('treats legacy json entries (no expiry metadata) as expired and deletes them', async () => {
    const getSong = getHandler('cache:getSongResources');
    // 模拟缓存统一重构前写入的旧格式条目：song: 语义键 json 数据文件 + 无 expiresAt 的 meta。
    // 审查修复后 JSON 缓存正确落 json/ 目录（修复前误落 bin/，此测试同步对齐正确目录）
    const key = ':json:song:legacy123';
    const md5 = crypto.createHash('md5').update(key).digest('hex');
    const dataDir = path.join(cacheDir, 'cache', 'json');
    const metaDir = path.join(cacheDir, 'cache', 'meta');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, md5), JSON.stringify({ url: 'https://expired.example.com/a.mp3' }));
    fs.writeFileSync(path.join(metaDir, `${md5}.json`), JSON.stringify({ key, size: 50 }));

    expect(await getSong({}, 'legacy123')).toBeNull();
    expect(fs.existsSync(path.join(dataDir, md5))).toBe(false);
  });

  it('getStats 返回统计对象', async () => {
    const getStats = getHandler('cache:getStats');
    const stats = await getStats({});
    expect(stats).toMatchObject({ entries: expect.any(Number), totalSize: expect.any(Number) });
  });

  it('归一化 key：同一封面不同签名共享同一磁盘项', async () => {
    const setCover = getHandler('cache:setCoverBytes');
    const getCover = getHandler('cache:getCoverPath');

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const urlA = 'https://api.example.com/api.php?get=pic&id=9&sign=AAA&t=1';
    const urlB = 'https://api.example.com/api.php?get=pic&id=9&sign=BBB&t=2';

    await setCover({}, urlA, png);
    // 归一化 key 同一：即使 URL 不同，getCoverPath 也命中同一磁盘文件
    const pathB = await getCover({}, urlB);
    expect(typeof pathB).toBe('string');
    expect(resourceUrlKey(urlA)).toBe(resourceUrlKey(urlB));
  });
});
