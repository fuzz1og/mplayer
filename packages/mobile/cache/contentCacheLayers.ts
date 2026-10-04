import type { CacheBackend, CachePort, ContentCache } from '@mplayer/core';
import { CONTENT_KEY_PREFIX, contentCacheKeyOf, isContentCacheKey } from './contentKeys';

/**
 * 内容元数据缓存的**纯逻辑**部分（#498 方案 A）：L1 同步 + L2 写穿 + 回填。
 *
 * 这里刻意不 import 任何 expo / 实例（内核与磁盘后端由调用方注入），
 * 于是单测能零 mock 地驱动全部语义；产线装配在 `services/contentCache.ts`。
 *
 * 为什么要有这一层：core 的 `ContentCache`（`shared/sourceRouter.ts`）是**同步**接口
 * （`get` 立即返回），而 `CacheKernel.getJSON` 是异步的——「内容也落盘」在现接口下
 * 没有合法实现。不改接口，改做「L1 同步 + L2 写穿 + 启动回填」。
 *
 * 已知边界（与 issue 评审的四条一一对应）：
 * 1. 内核真键是 `ns:type:key` 且 namespace 默认空串 → 形如 `:json:content:xxx`，
 *    因此按 `:json:content:` 过滤，而不是 `content:` 前缀（见 `cache/contentKeys`）；
 * 2. 回填要把键**还原一层**再交给 L1，否则 L1 键与写穿时的键不一致、回填等于白做；
 * 3. 写穿**复用** `CacheManager.set` 的空值判定（见 `isCacheable`）——内核的
 *    `setJSON` 没有空值语义，不补判定的话 L2 会存下「L1 拒写」的条目；
 * 4. `setJSON` 是异步的：用 `.catch` 收口，避免磁盘写失败变成 unhandled rejection。
 *
 * 冷启后的**第一次**访问仍会打一轮上游（回填在空闲期做、`get` 是同步的），
 * 收益从第二次访问起算——这正是 issue「验收前提」一节写明的口径。
 */

/** 回填上限：内容条目小，但启动期不宜无限过桥（issue 要求「有限量」）。 */
export const CONTENT_BACKFILL_LIMIT = 200;

/**
 * 是否可入缓存——与 `CacheManager.set` 的守卫**逐条一致**（不多不少）。
 * 写穿必须在同一处复用这份判定，否则 L1 拒绝的空值会从 L2 漏进去。
 * 注意结构体（如 `{ songs: [], total: 0 }`）本就不在守卫之列，两层保持一致。
 */
export function isCacheable(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (Array.isArray(data) && data.length === 0) return false;
  if (typeof data === 'string' && data.trim() === '') return false;
  return true;
}

/** 本层依赖的最小面：L1（同步） + 内核（异步 L2） + 磁盘后端（回填时读键与过期时间）。 */
export interface ContentCacheLayersDeps {
  l1: ContentCache;
  kernel: Pick<CachePort, 'getJSON' | 'setJSON'>;
  disk: Pick<CacheBackend, 'keys' | 'getExpiryAt'>;
}

export interface ContentCacheLayers {
  cache: ContentCache;
  /** 把 L2 里未过期的内容条目回填进 L1，返回回填条数。 */
  backfill: (limit?: number) => Promise<number>;
}

export function createContentCacheLayers(deps: ContentCacheLayersDeps): ContentCacheLayers {
  const cache: ContentCache = {
    get: <T,>(key: string) => deps.l1.get<T>(key),
    set: <T,>(key: string, data: T, ttlMs: number) => {
      if (!isCacheable(data)) return;
      deps.l1.set(key, data, ttlMs);
      // 写穿 L2：不 await（不阻塞调用方），失败只记一行——缓存是尽力而为的派生数据
      void deps.kernel.setJSON(CONTENT_KEY_PREFIX + key, data, ttlMs).catch((error) => {
        console.warn('[contentCache] L2 写穿失败:', error);
      });
    },
  };

  const backfill = async (limit: number = CONTENT_BACKFILL_LIMIT): Promise<number> => {
    let keys: string[];
    try {
      keys = await deps.disk.keys();
    } catch {
      return 0;
    }

    let restored = 0;
    for (const realKey of keys.filter(isContentCacheKey).slice(0, limit)) {
      // 还原一层命名空间：内核真键 → core ContentCache 的原键（L1 用的就是它）
      const key = contentCacheKeyOf(realKey);
      if (key === null) continue;

      // 过期的不回填：L1 只认「剩余时长」，不读回绝对过期时间就会把死条目复活
      const expiresAt = (await deps.disk.getExpiryAt?.(realKey)) ?? 0;
      if (expiresAt <= Date.now()) continue;

      const data = await deps.kernel.getJSON<unknown>(CONTENT_KEY_PREFIX + key).catch(() => null);
      if (data === null || data === undefined) continue;

      deps.l1.set(key, data, expiresAt - Date.now());
      restored++;
    }
    return restored;
  };

  return { cache, backfill };
}
