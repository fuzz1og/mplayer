import { beforeEach, describe, expect, it, vi } from 'vitest';

// expo-file-system 打桩：内存 Map 充当 L2 文件后端；同时统计过桥调用次数，
// 用来验证「统计不再逐文件 getInfoAsync」。
const mocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  const calls = { getInfo: 0, readDir: 0 };
  return {
    files,
    calls,
    cacheDirectory: 'file:///cache',
    readAsStringAsync: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error('ENOENT');
      return value;
    },
    writeAsStringAsync: async (path: string, data: string) => {
      files.set(path, data);
    },
    makeDirectoryAsync: async () => {},
    deleteAsync: async (path: string) => {
      for (const key of [...files.keys()]) {
        if (key.startsWith(path)) files.delete(key);
      }
    },
    readDirectoryAsync: async () => {
      calls.readDir++;
      return [] as string[];
    },
    getInfoAsync: async () => {
      calls.getInfo++;
      return { exists: false };
    },
  };
});

vi.mock('expo-file-system/legacy', () => mocks);

import { MobileFileBackend } from '../cache/fileBackend';

const dataPaths = () => [...mocks.files.keys()].filter(p => p.includes('/json/') || p.includes('/bin/'));

beforeEach(async () => {
  // 等上一个用例的索引防抖写入落地，再清空——否则它会在本用例中途冒出来污染索引
  await new Promise(resolve => setTimeout(resolve, 520));
  mocks.files.clear();
  mocks.calls.getInfo = 0;
  mocks.calls.readDir = 0;
});

/**
 * #410 ①③：移动端 L2 的类型目录判定与内核前缀不一致（全部落 bin/）、
 * 统计对每个文件串行 getInfoAsync 过桥。
 */
describe('#410 MobileFileBackend', () => {
  it('键类型判定与内核前缀一致：JSON 落 json/、二进制落 bin/', async () => {
    const backend = new MobileFileBackend();
    await backend.write(':json:song:1', new Uint8Array([123, 125]));
    await backend.write(':bin:audio:1', new Uint8Array([1, 2, 3]));

    const paths = dataPaths();
    expect(paths.some(p => p.includes('/mplayer-cache/json/'))).toBe(true);
    expect(paths.some(p => p.includes('/mplayer-cache/bin/'))).toBe(true);
    // 旧判定 startsWith('json:') 对 ':json:…' 永不匹配 → JSON 会被误落 bin/
    expect(paths.filter(p => p.includes('/mplayer-cache/bin/'))).toHaveLength(1);
  });

  it('磁盘统计读内存索引：getInfoAsync 零调用（不再逐文件过桥）', async () => {
    const backend = new MobileFileBackend();
    await backend.write(':json:song:1', new Uint8Array([1, 2, 3, 4]));
    await backend.write(':json:song:2', new Uint8Array([1, 2, 3, 4, 5]));

    const stats = await backend.getDiskStats();

    expect(stats).toEqual({ fileCount: 2, totalSize: 9 });
    expect(mocks.calls.getInfo).toBe(0);
  });

  it('删除与清空同步维护统计', async () => {
    const backend = new MobileFileBackend();
    await backend.write(':json:song:1', new Uint8Array([1, 2, 3]));
    await backend.write(':json:song:2', new Uint8Array([1, 2]));

    await backend.delete(':json:song:1');
    expect(await backend.getDiskStats()).toEqual({ fileCount: 1, totalSize: 2 });

    await backend.clear();
    expect(await backend.getDiskStats()).toEqual({ fileCount: 0, totalSize: 0 });
  });

  it('TTL 随索引持久化并在读时生效（此前 write 直接丢弃 expiresAt）', async () => {
    const backend = new MobileFileBackend();
    await backend.write(':json:song:1', new Uint8Array([1]), Date.now() + 40);

    expect(await backend.getExpiryAt(':json:song:1')).toBeGreaterThan(0);
    expect(await backend.read(':json:song:1')).not.toBeNull();

    await new Promise(resolve => setTimeout(resolve, 60));
    expect(await backend.read(':json:song:1')).toBeNull();
  });

  it('索引持久化：新实例从 index.json 恢复统计（无需重新扫描目录）', async () => {
    const first = new MobileFileBackend();
    await first.write(':json:song:1', new Uint8Array([1, 2, 3]));
    await new Promise(resolve => setTimeout(resolve, 600)); // 索引写入是防抖的

    const second = new MobileFileBackend();
    const stats = await second.getDiskStats();

    expect(stats).toEqual({ fileCount: 1, totalSize: 3 });
    expect(mocks.calls.getInfo).toBe(0);
    expect(mocks.calls.readDir).toBe(0);
  });

  it('keys() 返回真键（索引里存了原始 key），可直接交给 delete', async () => {
    const backend = new MobileFileBackend();
    await backend.write(':json:song:1', new Uint8Array([1]));

    expect(await backend.keys()).toEqual([':json:song:1']);

    await backend.delete((await backend.keys())[0]);
    expect(await backend.getDiskStats()).toEqual({ fileCount: 0, totalSize: 0 });
  });
});
