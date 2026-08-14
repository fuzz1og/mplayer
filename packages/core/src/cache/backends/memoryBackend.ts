import type { CacheBackend } from '../types'

export function createMemoryBackend(): CacheBackend {
  interface Entry {
    data: Uint8Array
    expiresAt: number
  }
  const map = new Map<string, Entry>()

  return {
    async read(key: string): Promise<Uint8Array | null> {
      const item = map.get(key)
      if (!item) return null
      if (item.expiresAt > 0 && Date.now() >= item.expiresAt) {
        map.delete(key)
        return null
      }
      return item.data
    },
    async write(key: string, data: Uint8Array, expiresAt?: number): Promise<void> {
      map.set(key, {
        data,
        expiresAt: expiresAt && expiresAt > 0 ? expiresAt : 0,
      })
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
