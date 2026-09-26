import type { CacheBackend } from '../types'
import { evictLruOverflow, touchLru } from '../lru'

export interface MemoryBackendOptions {
  /**
   * 条目上限（LRU）。`<= 0` 或省略 = 不限制。
   * 通常不直接传：`CacheKernel` 会用自己的 `maxMemoryEntries` 调 `setCapacity`。
   */
  maxEntries?: number
}

/**
 * L1 内存后端 —— **Map 顺序即 LRU 顺序**。
 *
 * #410 之前这只 Map 只增不减（仅在读到过期条目时删单条）：手机端单进程长驻，
 * 每播一首歌写一条 `song:<身份键>`、每看一次网易内容写一批 LRC，内存只涨不落。
 * `CacheKernel.maxMemoryEntries` 声明了容量却从未被读取。
 *
 * 现在：读命中把条目移到队尾（最近使用），写超限从队首（最久未用）淘汰。
 */
export function createMemoryBackend(options: MemoryBackendOptions = {}): CacheBackend {
  interface Entry {
    data: Uint8Array
    expiresAt: number
  }
  const map = new Map<string, Entry>()
  let capacity = options.maxEntries && options.maxEntries > 0 ? options.maxEntries : 0

  const evictOverflow = (): void => evictLruOverflow(map, capacity)

  return {
    setCapacity(maxEntries: number): void {
      capacity = maxEntries > 0 ? maxEntries : 0
      evictOverflow()
    },
    async read(key: string): Promise<Uint8Array | null> {
      const item = map.get(key)
      if (!item) return null
      if (item.expiresAt > 0 && Date.now() >= item.expiresAt) {
        map.delete(key)
        return null
      }
      // 命中即最近使用
      touchLru(map, key)
      return item.data
    },
    async write(key: string, data: Uint8Array, expiresAt?: number): Promise<void> {
      // 覆盖写也要挪到队尾，否则「持续更新的热键」会被当成最久未用淘汰
      map.delete(key)
      map.set(key, {
        data,
        expiresAt: expiresAt && expiresAt > 0 ? expiresAt : 0,
      })
      evictOverflow()
    },
    async getExpiryAt(key: string): Promise<number> {
      return map.get(key)?.expiresAt ?? 0
    },
    async delete(key: string): Promise<void> {
      map.delete(key)
    },
    async clear(): Promise<void> {
      map.clear()
    },
    async keys(): Promise<string[]> {
      return [...map.keys()]
    },
    stats() {
      return {
        hits: 0,
        misses: 0,
        entries: map.size,
        totalSize: 0,
        fileCount: map.size,
        songsCount: 0,
        coversCount: 0,
        audioCount: 0,
        urlsCount: 0,
      }
    },
  }
}
