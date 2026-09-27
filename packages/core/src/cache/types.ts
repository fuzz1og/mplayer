export interface CacheStats {
  hits: number
  misses: number
  entries: number
  totalSize: number
  fileCount: number
  songsCount: number
  coversCount: number
  audioCount: number
  urlsCount: number
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
  /**
   * 写入缓存条目。
   * @param expiresAt 绝对过期时间戳（ms）；0 / undefined 表示永不过期。
   *   支持 TTL 的后端应持久化该值，并在 read 时清理过期条目。
   */
  write(key: string, data: Uint8Array, expiresAt?: number): Promise<void>
  /** 返回条目绝对过期时间戳（ms），无过期信息返回 0；未实现时内核回退保守策略。 */
  getExpiryAt?(key: string): Promise<number>
  /**
   * 设置条目上限（LRU 淘汰）。内存后端实现，磁盘后端忽略。
   * `CacheKernel` 用它在构造时把 `maxMemoryEntries` 下传——此前该选项
   * 只是「声明 / 默认值 / 赋值」三处命中、**没有任何读取**，#410。
   */
  setCapacity?(maxEntries: number): void
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
  stats?(): CacheStats
}
