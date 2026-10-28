import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  /**
   * #510：TTL 是绝对时间戳，**不要用真墙钟赌「写→读 < 40ms」** —— 忙机器上这段窗口实测 p90 已达 
   * 1.4s（40ms 预算的 35 倍），断言会在与改动无关的 PR 上翻红。
   */
  it('读写往返；TTL 到期后视为未命中并删除条目', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const backend = new DiskCacheBackend(dir);
      const base = new Date('2026-01-01T00:00:00.000Z').getTime();
      vi.setSystemTime(base);
      await backend.write(':json:song:1', encoder.encode('{"url":"u"}'), base + 40);

      // 未到期（还差 1ms）：命中，且内容往返一致
      vi.setSystemTime(base + 39);
      const hit = await backend.read(':json:song:1');
      expect(hit).not.toBeNull();
      expect(new TextDecoder().decode(hit!)).toBe('{"url":"u"}');

      // 到期（now >= expiresAt）：视为未命中，并把条目删掉
      vi.setSystemTime(base + 40);
      expect(await backend.read(':json:song:1')).toBeNull();
      expect(await backend.keys()).not.toContain(':json:song:1');
    } finally {
      vi.useRealTimers();
    }
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

  it('同一目录的多个实例共享索引（否则 A 写的条目在 B 的 stats/keys 里永远看不见）', async () => {
    // main.ts 为汽水音频另建了一个 DiskCacheBackend，指向同一个 userData/cache。
    // 索引若按实例各持一份，kernel 后端的 stats() 就统计不到 `bin:soda:*`——
    // 而改成索引之前的实现是现遍历目录，能统计到（回归）。
    const kernelBackend = new DiskCacheBackend(dir);
    const audioBackend = new DiskCacheBackend(dir);

    await kernelBackend.write(':json:song:1', encoder.encode('{"url":"u"}'));
    await audioBackend.write('bin:soda:9', encoder.encode('xx'));

    expect(kernelBackend.stats().fileCount).toBe(2);
    expect(audioBackend.stats().fileCount).toBe(2);
    expect(await kernelBackend.keys()).toContain('bin:soda:9');
  });

  it('clear 后同目录另一实例的索引同时归零（不留幽灵条目）', async () => {
    const a = new DiskCacheBackend(dir);
    const b = new DiskCacheBackend(dir);
    await a.write(':json:song:1', encoder.encode('{"url":"u"}'));
    expect(b.stats().fileCount).toBe(1);

    await b.clear();

    expect(a.stats().fileCount).toBe(0);
    expect(await a.keys()).toEqual([]);
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

/**
 * 1.9.0 原型 §2：空间上限 + 自动清理（cache:getConfig / setLimitMb / setAutoClean 的后端侧）。
 * 淘汰只发生在写路径记账之后，按写入时刻从早到晚；读与统计不删东西。
 */
describe('容量上限与最旧条目淘汰', () => {
  it('超上限时按写入顺序淘汰最旧条目，最新条目保住', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const backend = new DiskCacheBackend(dir);
      const base = new Date('2026-01-01T00:00:00.000Z').getTime();
      vi.setSystemTime(base);
      const payload = encoder.encode('random-bytes-not-an-image');
      const one = payload.byteLength;

      // 上限 = 3 条：写 5 条，最早的 2 条应被回收
      backend.setLimits(one * 3, true);
      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(base + i * 1000);
        await backend.write(`:bin:audio:${i}`, payload);
      }

      expect(backend.stats().fileCount).toBe(3);
      const keys = await backend.keys();
      expect(keys).not.toContain(':bin:audio:0');
      expect(keys).not.toContain(':bin:audio:1');
      expect(keys).toContain(':bin:audio:4');
      // 字节与类别计数同步回落
      expect(backend.stats().totalSize).toBe(one * 3);
      expect(backend.stats().audioCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('自动清理关闭时不淘汰（只停手，不动已落盘内容）', async () => {
    const backend = new DiskCacheBackend(dir);
    const payload = encoder.encode('random-bytes-not-an-image');
    backend.setLimits(payload.byteLength, false);
    await backend.write(':bin:audio:0', payload);
    await backend.write(':bin:audio:1', payload);

    expect(backend.stats().fileCount).toBe(2);
    expect(backend.getLimits()).toMatchObject({ limitBytes: payload.byteLength, autoClean: false });
  });

  it('上限为 0 = 不设上限；单条目超上限时不自我清空', async () => {
    const backend = new DiskCacheBackend(dir);
    const payload = encoder.encode('random-bytes-not-an-image');

    backend.setLimits(0, true);
    await backend.write(':bin:audio:0', payload);
    await backend.write(':bin:audio:1', payload);
    expect(backend.stats().fileCount).toBe(2);

    // 1 字节上限：每条都超，keepHash 保证刚写入的那条活着（否则缓存永远写不进去）
    backend.setLimits(1, true);
    await backend.write(':bin:audio:2', payload);
    expect(await backend.read(':bin:audio:2')).not.toBeNull();
  });

  it('enforceLimit 立刻回收（设置页调小上限后马上见效）', async () => {
    const backend = new DiskCacheBackend(dir);
    const payload = encoder.encode('random-bytes-not-an-image');
    for (let i = 0; i < 4; i++) await backend.write(`:bin:audio:${i}`, payload);

    backend.setLimits(payload.byteLength * 2, true);
    const result = await backend.enforceLimit();
    expect(result.removed).toBe(2);
    expect(backend.stats().fileCount).toBe(2);
  });

  it('同一目录的第二个实例共享上限（汽水音频后端不各持一套）', async () => {
    const kernel = new DiskCacheBackend(dir);
    const audio = new DiskCacheBackend(dir);
    const payload = encoder.encode('random-bytes-not-an-image');

    kernel.setLimits(payload.byteLength, true);
    expect(audio.getLimits().limitBytes).toBe(payload.byteLength);

    await kernel.write(':bin:audio:0', payload);
    await audio.write(':bin:audio:1', payload);
    expect(kernel.stats().fileCount).toBe(1);
    expect(await audio.read(':bin:audio:0')).toBeNull();
  });

  it('每类别字节数与计数同批维护（构成行「N 个 · X B」的数据源）', async () => {
    const backend = new DiskCacheBackend(dir);
    await backend.write(':json:search:1', encoder.encode('[{"id":"1"}]'));
    const songsBytes = backend.bytesByKind().songs;
    expect(songsBytes).toBeGreaterThan(0);

    await backend.write(':bin:audio:1', encoder.encode('random-bytes'));
    expect(backend.bytesByKind().audio).toBeGreaterThan(0);

    await backend.delete(':json:search:1');
    expect(backend.bytesByKind().songs).toBe(0);

    await backend.clear();
    expect(Object.values(backend.bytesByKind()).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('装载旧 meta（无 writtenAt）时不崩，且按最旧优先淘汰', async () => {
    const first = new DiskCacheBackend(dir);
    await first.write(':bin:audio:legacy', encoder.encode('random-bytes'));
    // 抹掉 writtenAt，模拟 1.9.0 之前写下的 meta
    const metaDir = path.join(dir, 'meta');
    for (const file of fs.readdirSync(metaDir)) {
      const full = path.join(metaDir, file);
      const meta = JSON.parse(fs.readFileSync(full, 'utf-8'));
      delete meta.writtenAt;
      fs.writeFileSync(full, JSON.stringify(meta));
    }

    const second = new DiskCacheBackend(dir);
    await second.ensureIndexReady();
    expect(second.stats().fileCount).toBe(1);

    // 旧条目 writtenAt 记 0 → 排最前，新条目把它挤掉（上限只够一条）
    second.setLimits(12, true);
    await second.write(':bin:audio:new', encoder.encode('random-bytes'));
    const keys = await second.keys();
    expect(keys).toContain(':bin:audio:new');
    expect(keys).not.toContain(':bin:audio:legacy');
  });
});
