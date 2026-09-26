import { cacheDirectory, readAsStringAsync, writeAsStringAsync, makeDirectoryAsync, deleteAsync, getInfoAsync } from 'expo-file-system/legacy'
import { cacheKeyType, md5 } from '@mplayer/core'
import type { CacheBackend } from '@mplayer/core'

interface IndexEntry {
  /** 原始缓存键（内核格式 `ns:type:key`）——有了它 keys() 返回的就是真键，可以直接 remove */
  key: string
  size: number
  /** 绝对过期时间戳（ms）；0 = 永不过期 */
  expiresAt: number
}

/**
 * 移动端磁盘缓存后端（L2，expo cacheDirectory）。
 *
 * #410 三条修复：
 * 1. **类型目录判定**：此前是 `key.startsWith('json:')`，而内核生成的键形如
 *    ``:json:…``——永远不匹配，于是**所有条目都落进 `bin/``**（桌面修过同一个 bug，
 *    移动端漏修）。现在走 core 的 `cacheKeyType` 单点判定。
 * 2. **TTL 真正生效**：此前 `write` 直接丢弃 `expiresAt`，L2 条目永不过期；且没有
 *    `getExpiryAt`，内核回填 L1 时只能传 0，连 L1 也跟着永不过期。现在过期时间
 *    随索引持久化，`read` 判过期即删，`getExpiryAt` 供内核回填。
 * 3. **统计 O(1)**：`getDiskStats()` 此前对**每个文件**串行 `getInfoAsync` 过桥
 *    （设置页一进去就跑一遍全目录）。现在读内存索引（启动时装载一次）。
 */
export class MobileFileBackend implements CacheBackend {
  private baseDir: string
  private indexPath: string

  /** hash → 条目（内存索引；getDiskStats 的唯一数据源） */
  private index = new Map<string, IndexEntry>()
  private totalSize = 0
  private fileCount = 0

  private indexReady: Promise<void> | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.baseDir = `${cacheDirectory}/mplayer-cache`
    this.indexPath = `${this.baseDir}/index.json`
  }

  private hashKey(key: string): string {
    return md5(key)
  }

  private resolvePath(key: string): string {
    return `${this.baseDir}/${cacheKeyType(key)}/${this.hashKey(key)}`
  }

  private ensureIndex(): Promise<void> {
    if (!this.indexReady) this.indexReady = this.loadIndex()
    return this.indexReady
  }

  /**
   * 装载索引。两种情况必须分开处理（一次 `getInfoAsync` 探测，不是逐文件）：
   *
   * - **索引文件不存在** = 首启，或从旧版本升级——旧版本的条目全部落在 `bin/`
   *   （上面第 1 条 bug），新代码按类型目录去找一条也命中不了，那批缓存本来就已经
   *   不可达；直接整目录清掉重新开始，比逐个文件过桥补判更划算。
   * - **索引文件在但读/解析失败** = 索引坏了，**不能连缓存文件一起清**：那会把一次
   *   瞬时读失败升级成整份缓存丢失。本次统计从 0 起，缓存读写照常（`read` 不依赖索引）。
   */
  private async loadIndex(): Promise<void> {
    let exists = false
    try {
      const info = await getInfoAsync(this.indexPath)
      exists = info.exists === true
    } catch {
      exists = false
    }

    if (exists) {
      try {
        const raw = await readAsStringAsync(this.indexPath, { encoding: 'utf8' })
        const parsed = JSON.parse(raw) as Record<string, IndexEntry>
        for (const [hash, entry] of Object.entries(parsed)) {
          if (!entry || typeof entry.size !== 'number' || typeof entry.key !== 'string') continue
          this.index.set(hash, {
            key: entry.key,
            size: entry.size,
            expiresAt: typeof entry.expiresAt === 'number' ? entry.expiresAt : 0,
          })
        }
      } catch {
        // 坏索引：保持空表即可，磁盘缓存不动
        this.index.clear()
      }
      this.recount()
      return
    }

    this.index.clear()
    this.recount()
    try {
      await deleteAsync(this.baseDir, { idempotent: true })
    } catch {
      // 目录不存在 = 本来就没缓存
    }
    await this.persistIndex()
  }

  private recount(): void {
    this.totalSize = 0
    this.fileCount = 0
    for (const entry of this.index.values()) {
      this.totalSize += entry.size
      this.fileCount++
    }
  }

  /** O(1) 增量记账：摘旧挂新。 */
  private applyEntry(hash: string, next: IndexEntry | null): void {
    const prev = this.index.get(hash)
    if (prev) {
      this.totalSize -= prev.size
      this.fileCount--
      this.index.delete(hash)
    }
    if (next) {
      this.index.set(hash, next)
      this.totalSize += next.size
      this.fileCount++
    }
  }

  /** 索引持久化合并到一次写入（防抖），避免每次读写都过桥写一个文件。 */
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistIndex()
    }, 500)
  }

  private async persistIndex(): Promise<void> {
    try {
      await makeDirectoryAsync(this.baseDir, { intermediates: true })
      const payload: Record<string, IndexEntry> = {}
      for (const [hash, entry] of this.index) payload[hash] = entry
      await writeAsStringAsync(this.indexPath, JSON.stringify(payload), { encoding: 'utf8' })
    } catch {
      // 索引写失败只是统计退化为 0，不影响缓存读写
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    await this.ensureIndex()
    const hash = this.hashKey(key)
    const entry = this.index.get(hash)
    // TTL 过期：删除并视为未命中（重新获取）
    if (entry && entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
      await this.delete(key)
      return null
    }
    try {
      const base64 = await readAsStringAsync(this.resolvePath(key), { encoding: 'base64' })
      return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    } catch {
      return null
    }
  }

  async write(key: string, data: Uint8Array, expiresAt?: number): Promise<void> {
    await this.ensureIndex()
    const filePath = this.resolvePath(key)
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    await makeDirectoryAsync(dir, { intermediates: true })
    // 分块转 base64：大数组直接 spread 到 String.fromCharCode 会爆调用栈（RangeError），
    // 歌词/封面等大 payload 进入 L2 缓存时也不能崩
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < data.length; i += CHUNK) {
      binary += String.fromCharCode(...data.subarray(i, i + CHUNK))
    }
    const base64 = btoa(binary)
    await writeAsStringAsync(filePath, base64, { encoding: 'base64' })

    this.applyEntry(this.hashKey(key), {
      key,
      size: data.byteLength,
      expiresAt: expiresAt && expiresAt > 0 ? expiresAt : 0,
    })
    this.schedulePersist()
  }

  async getExpiryAt(key: string): Promise<number> {
    await this.ensureIndex()
    const entry = this.index.get(this.hashKey(key))
    return entry && entry.expiresAt > 0 ? entry.expiresAt : 0
  }

  async delete(key: string): Promise<void> {
    await this.ensureIndex()
    try {
      await deleteAsync(this.resolvePath(key), { idempotent: true })
    } catch {
      // ignore
    }
    this.applyEntry(this.hashKey(key), null)
    this.schedulePersist()
  }

  async clear(): Promise<void> {
    await this.ensureIndex()
    try {
      await deleteAsync(this.baseDir, { idempotent: true })
    } catch {
      // ignore
    }
    this.index.clear()
    this.recount()
    await this.persistIndex()
  }

  /** 索引里存着原始键，所以这里返回的是**真键**，可以直接交给 remove()。 */
  async keys(): Promise<string[]> {
    await this.ensureIndex()
    return [...this.index.values()].map(entry => entry.key)
  }

  /**
   * 磁盘占用统计（设置页展示）。
   * 读内存索引 → **O(1)、零过桥**；此前对每个文件 `getInfoAsync` 串行过桥。
   */
  async getDiskStats(): Promise<{ fileCount: number; totalSize: number }> {
    await this.ensureIndex()
    return { fileCount: this.fileCount, totalSize: this.totalSize }
  }
}
