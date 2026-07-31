export interface CacheStats {
  hits: number
  misses: number
  entries: number
}

export interface CachePort {
  getJSON<T>(key: string): Promise<T | null>
  setJSON<T>(key: string, value: T, ttlMs: number): Promise<void>
  getBinary(key: string): Promise<Uint8Array | null>
  setBinary(key: string, data: Uint8Array, ttlMs: number): Promise<void>
  has(key: string): Promise<boolean>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  stats(): CacheStats
}

export interface CacheBackend {
  read(key: string): Promise<Uint8Array | null>
  write(key: string, data: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}