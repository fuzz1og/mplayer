import { describe, it, expect } from 'vitest';
import type { ContentCache } from '@mplayer/core';
import { createContentCacheLayers, isCacheable } from '../cache/contentCacheLayers';

/**
 * #498 方案 A：移动端内容缓存的写穿 + 启动回填。
 *
 * 这层存在的唯一理由是 core 的 `ContentCache` 是**同步**接口，而内核 `getJSON` 是
 * 异步的——所以做「L1 同步 + L2 写穿 + 启动回填」。下面五条全部零真实网络/零真实磁盘，
 * 用内存假件驱动，逐条钉住 issue 评审点名的坑：
 *
 * 1. 内核真键是 `:json:content:<原键>`（namespace 空），过滤不能用裸 `content:`；
 * 2. 回填必须把键**还原一层**，否则 L1 键与写穿键不一致、回填等于白做；
 * 3. 写穿不能绕过 `CacheManager.set` 的空值判定；
 * 4. L2 写失败不能变成 unhandled rejection（由 `.catch` 收口 —— 见「写穿失败不炸」）。
 */

/** 内核真键前缀（namespace 取默认空串）：与 `cacheKernel.prefix()` 同形。 */
const KERNEL_JSON = ':json:';

/**
 * 假件刻意**都不带**空值守卫：这样第 3 条用例证明的是本层自己的判定在起作用，
 * 而不是被 L1 顺手挡掉了。
 */
function makeHarness() {
  const l1Store = new Map<string, { data: unknown; expiresAt: number }>();
  const disk = new Map<string, { data: unknown; expiresAt: number }>();

  const l1: ContentCache = {
    get: <T,>(key: string) => {
      const entry = l1Store.get(key);
      if (!entry) return null;
      if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
        l1Store.delete(key);
        return null;
      }
      return entry.data as T;
    },
    set: <T,>(key: string, data: T, ttlMs: number) => {
      l1Store.set(key, { data, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 });
    },
  };

  const kernel = {
    getJSON: async <T,>(key: string): Promise<T | null> => {
      const entry = disk.get(KERNEL_JSON + key);
      if (!entry) return null;
      if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) return null;
      return entry.data as T;
    },
    setJSON: async <T,>(key: string, value: T, ttlMs: number): Promise<void> => {
      disk.set(KERNEL_JSON + key, { data: value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 });
    },
  };

  const diskPort = {
    keys: async () => [...disk.keys()],
    getExpiryAt: async (key: string) => disk.get(key)?.expiresAt ?? 0,
  };

  return { l1, l1Store, disk, kernel, diskPort, ...createContentCacheLayers({ l1, kernel, disk: diskPort }) };
}

describe('#498/A：内容缓存写穿', () => {
  it('set 同步进 L1，并以 :json:content: 真键写穿 L2', async () => {
    const h = makeHarness();
    h.cache.set('album_detail_1', { songs: [1], total: 1 }, 60_000);

    expect(h.cache.get('album_detail_1')).toEqual({ songs: [1], total: 1 });
    expect(h.disk.has(KERNEL_JSON + 'content:album_detail_1')).toBe(true);
  });

  it('空值不入库：L1 与 L2 都不存（不绕过 CacheManager.set 的守卫）', async () => {
    const h = makeHarness();
    h.cache.set('empty_array', [], 60_000);
    h.cache.set('empty_string', '   ', 60_000);
    h.cache.set('null_value', null, 60_000);

    expect(h.l1Store.size).toBe(0);
    expect(h.disk.size).toBe(0);
  });

  it('结构体（{songs:[],total:0}）照存：与 CacheManager.set 的判定逐条一致，不额外加码', async () => {
    const h = makeHarness();
    h.cache.set('empty_page', { songs: [], total: 0 }, 60_000);

    // CacheManager 只拒 null/空数组/空串，结构体不在其列 —— 两层保持同一语义
    expect(isCacheable({ songs: [], total: 0 })).toBe(true);
    expect(h.l1Store.has('empty_page')).toBe(true);
    expect(h.disk.has(KERNEL_JSON + 'content:empty_page')).toBe(true);
  });

  it('L2 写穿失败只记一行，不炸成 unhandled rejection', async () => {
    const h = makeHarness();
    h.disk.clear();
    const failing = createContentCacheLayers({
      l1: h.l1,
      kernel: {
        getJSON: async () => null,
        setJSON: async () => {
          throw new Error('磁盘炸了');
        },
      },
      disk: h.diskPort,
    });

    expect(() => failing.cache.set('k', [1], 60_000)).not.toThrow();
    // 写穿是 fire-and-forget：L1 已经拿到值，异步失败由 .catch 收口
    expect(h.l1.get('k')).toEqual([1]);
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('#498/A：启动回填', () => {
  it('把 L2 内容条目读回 L1，且键还原成 core 原键（不是 content:xxx）', async () => {
    const h = makeHarness();
    h.disk.set(KERNEL_JSON + 'content:artist_info_9', { data: { name: 'A' }, expiresAt: Date.now() + 60_000 });

    const restored = await h.backfill();

    expect(restored).toBe(1);
    expect(h.l1.get('artist_info_9')).toEqual({ name: 'A' });
    // 还原失败会落成 'content:artist_info_9' —— 那正是 issue 说的「回填等于白做」
    expect(h.l1.get('content:artist_info_9')).toBeNull();
  });

  it('过期条目不回填（T1 里的绝对过期时间必须转成 L1 的剩余时长）', async () => {
    const h = makeHarness();
    h.disk.set(KERNEL_JSON + 'content:stale', { data: { name: '旧' }, expiresAt: Date.now() - 1 });

    const restored = await h.backfill();

    expect(restored).toBe(0);
    expect(h.l1.get('stale')).toBeNull();
  });

  it('只碰内容条目：播放资源值等条目不进 L1', async () => {
    const h = makeHarness();
    h.disk.set(KERNEL_JSON + 'song:netease:1', { data: { url: 'https://x/1.mp3' }, expiresAt: Date.now() + 60_000 });
    h.disk.set(':bin:cover:abc', { data: { url: 'x' }, expiresAt: Date.now() + 60_000 });

    const restored = await h.backfill();

    expect(restored).toBe(0);
    expect(h.l1Store.size).toBe(0);
  });

  it('回填有上限（启动期不无限过桥）', async () => {
    const h = makeHarness();
    for (let i = 0; i < 3; i++) {
      h.disk.set(KERNEL_JSON + 'content:key_' + i, { data: i, expiresAt: Date.now() + 60_000 });
    }

    const restored = await h.backfill(2);

    expect(restored).toBe(2);
    expect(h.l1Store.size).toBe(2);
  });
});