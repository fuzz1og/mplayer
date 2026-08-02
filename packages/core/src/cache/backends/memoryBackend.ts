import type { CacheBackend } from '../types'

export function createMemoryBackend(): CacheBackend {
  const map = new Map<string, Uint8Array>()

  return {
    async read(key: string): Promise<Uint8Array | null> {
      return map.get(key) ?? null
    },
    async write(key: string, data: Uint8Array): Promise<void> {
      map.set(key, data)
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
