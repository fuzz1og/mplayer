import { cacheManager } from '@mplayer/core';
import type { ContentCache } from '@mplayer/core';
import { cacheKernel, fileBackend } from './cacheService';
import { createContentCacheLayers } from '../cache/contentCacheLayers';

/**
 * 移动端内容缓存的**产线装配**（#498 方案 A）：把 core 的 `cacheManager`（L1）、
 * 移动端 `CacheKernel`（L2 写穿）与磁盘后端（启动回填）接成一个 `ContentCache`。
 *
 * 纯逻辑在 `cache/contentCacheLayers.ts`（可零 mock 单测），这里只做接线。
 *
 * 用法：`registerDirectClient(createNeteaseDirectClient(mobileContentCache))`
 * （见 `app/_layout.tsx`）；`backfillContentCache()` 在首帧后调用。
 * 桌面端不受影响——它继续用 core 默认的那份 `defaultContentCache`。
 */
const layers = createContentCacheLayers({
  l1: cacheManager,
  kernel: cacheKernel,
  disk: fileBackend,
});

/** 移动端内容缓存（注入给 `createNeteaseDirectClient`）。 */
export const mobileContentCache: ContentCache = layers.cache;

/** 首帧后调用：把上次会话落盘的内容元数据读回 L1（限量、不阻塞启动）。 */
export const backfillContentCache = layers.backfill;
