import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFileSync } from 'node:fs';
import { DiskCacheBackend } from '../../main/cache/diskBackend';

const encoder = new TextEncoder();
let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-disk-cache-'));
});

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/**
 * #410 ②③：磁盘缓存是「伪 async」（async read/write 内部全是 fs.*Sync，与 IPC、
 * 下载、托盘抢同一个事件循环）；cache:getStats 是 O(文件数) 的同步递归遍历。
 */
describe('#410 DiskCacheBackend：真异步 + O(1) 统计', () => {
  it('不再有 *Sync 调用（源码级守卫）', () => {
    const source = readFileSync(path.join(__dirname, '../../main/cache/diskBackend.ts'), 'utf-8');
    // `fsp.readdir` / `fsp.writeFile` 是异步 API，不含 Sync；匹配的是 `readFileSync(` 这类
    expect(source).not.toMatch(/\w+Sync\(/);
  });

  it('stats() 不触碰文件系统（不再是 O(条目数) 的同步遍历）', () => {
    const source = readFileSync(path.join(__dirname, '../../main/cache/diskBackend.ts'), 'utf-8');
    const body = source.slice(source.indexOf('stats(): CacheStats'), source.indexOf('getFilePath'));
    expect(body.length).toBeGreaterThan(0);
    for (const forbidden of ['readdir', 'readFile', 'lstat', 'statSync', 'readHeader', 'JSON.parse']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it('键类型判定与内核前缀一致：JSON 落 json/、二进制落 bin/', async () => {
    const backend = new DiskCacheBackend(dir);
    await backend.write(':json:song:netease:1', encoder.encode('{"url":"https://x/a.mp3"}'));
    await backend.write(':bin:audio:abc', encoder.encode('not-an-image'));

    expect(fs.readdirSync(path.join(dir, 'json'))).toHaveLength(1);
    expect(fs.readdirSync(path.join(dir, 'bin'))).toHaveLength(1);
    // 带 namespace 的键同样落在 json/（旧判定 startsWith('json:') 会漏）
    await backend.write('ns:json:song:2', encoder.encode('[1]'));
    expect(fs.readdirSync(path.join(dir, 'json'))).toHaveLength(2);
  });

  it('读写往返；TTL 到期后视为未命中并删除条目', async () => {
    const backend = new DiskCacheBackend(dir);
    await backend.write(':json:song:1', encoder.encode('{"url":"u"}'), Date.now() + 40);

    expect(await backend.read(':json:song:1')).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, 60));

    expect(await backend.read(':json:song:1')).toBeNull();
    expect(await backend.keys()).not.toContain(':json:song:1');
  });

  it('统计按写入/删除/清空增量维护', async () => {
    const backend = new DiskCacheBackend(dir);
    await backend.write(':json:song:1', encoder.encode('{"url":"u"}')); // 含 url 字符串 → urls（与旧口径一致）
    await backend.write(':json:search:1', encoder.encode('[{"id":"1"}]')); // 数组 → songs
    await backend.write(':bin:audio:1', encoder.encode('random-bytes')); // 非图片 → audio

    expect(backend.stats()).toMatchObject({ fileCount: 3, songsCount: 1, urlsCount: 1, audioCount: 1 });
    expect(backend.stats().totalSize).toBeGreaterThan(0);

    await backend.delete(':json:search:1');
    expect(backend.stats()).toMatchObject({ fileCount: 2, songsCount: 0 });

    await backend.clear();
    expect(backend.stats()).toMatchObject({ fileCount: 0, totalSize: 0, songsCount: 0, urlsCount: 0 });
  });

  it('重建实例后统计从 meta 索引恢复（不必再遍历内容）', async () => {
    const first = new DiskCacheBackend(dir);
    await first.write(':json:song:1', encoder.encode('{"url":"u"}'));
    await first.write(':bin:audio:1', encoder.encode('xx'));

    const second = new DiskCacheBackend(dir);
    await second.ensureIndexReady();

    expect(second.stats()).toMatchObject({ fileCount: 2, urlsCount: 1, audioCount: 1 });
    expect(await second.keys()).toHaveLength(2);
  });

  it('并发写入被写队列串行化，互不踩踏', async () => {
    const backend = new DiskCacheBackend(dir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => backend.write(`:json:song:${i}`, encoder.encode(JSON.stringify({ i })))),
    );

    expect(backend.stats().fileCount).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(await backend.read(`:json:song:${i}`)).not.toBeNull();
    }
  });
});
