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
import { DiskCacheBackend } from '../../main/cache/diskBackend';

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
    // 封面四通道随「直链直渲」整链删除（#273）：不再注册
    const coverChannels = ['cache:getCoverPath','cache:setCoverBytes','cache:downloadCover','cache:invalidateCover'];
    for (const c of coverChannels) {
      expect(registered).not.toContain(c);
    }
    // 歌曲三件套语义通道全部注册（clear/getStats 通用通道保留）
    const semantics = ['cache:getSongResources','cache:setSongResources','cache:clear','cache:getStats'];
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

  it('clear 清空歌曲资源缓存', async () => {
    const setSong = getHandler('cache:setSongResources');
    const getSong = getHandler('cache:getSongResources');
    const clear = getHandler('cache:clear');

    await setSong({}, 'x', { url: 'u', cover: 'c', lrc: 'l' });
    await clear({});
    expect(await getSong({}, 'x')).toBeNull();
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

  it('clearKind 非法类型返回 false，且不误删缓存', async () => {
    const backend = new DiskCacheBackend(path.join(cacheDir, 'cache'));
    await backend.write(':json:test:keep', new TextEncoder().encode('[{"id":"keep"}]'));

    const clearKind = getHandler('cache:clearKind');
    expect(await clearKind({}, 'songs')).toBe(false);
    expect(await clearKind({}, 'cover')).toBe(false);
    expect(await clearKind({}, null)).toBe(false);
    expect(await backend.read(':json:test:keep')).not.toBeNull();
  });

  it('clearKind 按类型清理：歌曲索引清空 songs/urls/other，封面与音频保留', async () => {
    const clear = getHandler('cache:clear');
    await clear({});

    const backend = new DiskCacheBackend(path.join(cacheDir, 'cache'));
    const cover = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const audio = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00]);
    const encoder = new TextEncoder();
    // songs / urls / other 都是 JSON 目录下的条目，同属「歌曲索引」组。
    await backend.write(':json:test:songs', encoder.encode('[{"id":"s1"}]'));
    await backend.write(':json:test:urls', encoder.encode('{"url":"https://example.com/a.mp3"}'));
    await backend.write(':json:test:other', encoder.encode('not-json'));
    await backend.write(':bin:test:cover', cover);
    await backend.write(':bin:test:audio', audio);

    const getStats = getHandler('cache:getStats');
    const before = await getStats({});
    expect(before).toMatchObject({ entries: 5, songsCount: 1, urlsCount: 1, coversCount: 1, audioCount: 1 });
    expect(before.bytes.other).toBeGreaterThan(0);

    const clearKind = getHandler('cache:clearKind');
    expect(await clearKind({}, 'index')).toBe(true);

    const afterIndex = await getStats({});
    expect(afterIndex).toMatchObject({ entries: 2, songsCount: 0, urlsCount: 0, coversCount: 1, audioCount: 1 });
    expect(afterIndex.bytes.songs).toBe(0);
    expect(afterIndex.bytes.urls).toBe(0);
    expect(afterIndex.bytes.other).toBe(0);
    expect(afterIndex.bytes.covers).toBe(cover.byteLength);
    expect(afterIndex.bytes.audio).toBe(audio.byteLength);
    expect(await backend.read(':json:test:songs')).toBeNull();

    expect(await clearKind({}, 'covers')).toBe(true);
    const afterCovers = await getStats({});
    expect(afterCovers).toMatchObject({ entries: 1, coversCount: 0, audioCount: 1 });
    expect(afterCovers.bytes.covers).toBe(0);
    expect(afterCovers.bytes.audio).toBe(audio.byteLength);

    expect(await clearKind({}, 'audio')).toBe(true);
    const afterAudio = await getStats({});
    expect(afterAudio).toMatchObject({ entries: 0, coversCount: 0, audioCount: 0, totalSize: 0 });
  });
});
