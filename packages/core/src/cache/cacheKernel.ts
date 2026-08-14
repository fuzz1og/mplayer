import type { CacheBackend, CachePort, CacheStats } from './types'

export interface CacheKernelOptions {
  l1?: CacheBackend
  l2?: CacheBackend
  maxMemoryEntries?: number
  namespace?: string
}

export class CacheKernel implements CachePort {
  private l1?: CacheBackend
  private l2?: CacheBackend
  private maxMemoryEntries: number
  private namespace: string

  private hits = 0
  private misses = 0

  constructor(options: CacheKernelOptions) {
    this.l1 = options.l1
    this.l2 = options.l2
    this.maxMemoryEntries = options.maxMemoryEntries ?? 1000
    this.namespace = options.namespace ?? ''
  }

  private prefix(key: string, type: 'json' | 'bin'): string {
    return `${this.namespace}:${type}:${key}`
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const data = await this.getBinaryInternal(this.prefix(key, 'json'))
    if (!data) return null
    try {
      const str = new TextDecoder().decode(data)
      return JSON.parse(str) as T
    } catch {
      return null
    }
  }

  async setJSON<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const str = JSON.stringify(value)
    const data = new TextEncoder().encode(str)
    await this.setBinaryInternal(this.prefix(key, 'json'), data, ttlMs)
  }

  async getBinary(key: string): Promise<Uint8Array | null> {
    return this.getBinaryInternal(this.prefix(key, 'bin'))
  }

  async setBinary(key: string, data: Uint8Array, ttlMs: number): Promise<void> {
    await this.setBinaryInternal(this.prefix(key, 'bin'), data, ttlMs)
  }

  async has(key: string): Promise<boolean> {
    const jsonHit = await this.getBinaryInternal(this.prefix(key, 'json'))
    if (jsonHit) return true
    const binHit = await this.getBinaryInternal(this.prefix(key, 'bin'))
    return binHit !== null
  }

  async remove(key: string): Promise<void> {
    await this.l1?.delete(this.prefix(key, 'json'))
    await this.l1?.delete(this.prefix(key, 'bin'))
    await this.l2?.delete(this.prefix(key, 'json'))
    await this.l2?.delete(this.prefix(key, 'bin'))
  }

  async clear(): Promise<void> {
    await this.l1?.clear()
    await this.l2?.clear()
  }

  stats(): CacheStats {
    const diskStats = this.l2?.stats?.()
    return {
      hits: this.hits,
      misses: this.misses,
      entries: diskStats?.entries ?? 0,
      totalSize: diskStats?.totalSize ?? 0,
      fileCount: diskStats?.fileCount ?? 0,
      songsCount: diskStats?.songsCount ?? 0,
      coversCount: diskStats?.coversCount ?? 0,
      audioCount: diskStats?.audioCount ?? 0,
      urlsCount: diskStats?.urlsCount ?? 0,
    }
  }

  private async getBinaryInternal(key: string): Promise<Uint8Array | null> {
    // L1 first
    if (this.l1) {
      const data = await this.l1.read(key)
      if (data) { this.hits++; return data }
    }
    // L2 fallback
    if (this.l2) {
      const data = await this.l2.read(key)
      if (data) {
        this.hits++
        // Backfill L1（保留 L2 的剩余过期时间，避免 L1 把过期条目复活）
        if (this.l1) {
          const expiresAt = this.l2.getExpiryAt
            ? await this.l2.getExpiryAt(key).catch(() => 0)
            : 0
          await this.l1.write(key, data, expiresAt)
        }
        return data
      }
    }
    this.misses++
    return null
  }

  private async setBinaryInternal(key: string, data: Uint8Array, ttlMs: number): Promise<void> {
    // TTL 在此真正生效：转成绝对过期时间戳传给后端持久化。
    // 之前的实现丢弃 ttlMs，导致 URL 缓存永不失效（回归：旧 CacheManager
    // 的 url 缓存 12h 过期）。0 表示永不过期（音频等长驻缓存）。
    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0
    // Write-through: L1 + L2
    await this.l1?.write(key, data, expiresAt)
    await this.l2?.write(key, data, expiresAt)
  }
}
