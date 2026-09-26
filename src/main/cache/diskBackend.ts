import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { cacheKeyType, isImageBytes, isAudioBytes, type CacheBackend, type CacheStats } from '@mplayer/core'

/**
 * 缓存条目类别 —— `stats()` 的分类计数按此**增量**维护（写入时判定一次），
 * 不再每次统计都递归遍历目录 + `JSON.parse` 每个文件 + 读每个二进制文件头（#410）。
 * `other` = 内容无法解析（旧实现里这类文件只计入 fileCount，不进四个分类）。
 */
type EntryKind = 'songs' | 'urls' | 'covers' | 'audio' | 'other'

const ENTRY_KINDS: readonly EntryKind[] = ['songs', 'urls', 'covers', 'audio', 'other']

interface MetaRecord {
  key: string
  size: number
  /** 绝对过期时间戳（ms）；0 = 永不过期。 */
  expiresAt: number
  kind: EntryKind
  /**
   * 旧格式条目（缓存统一重构前写入，meta 里没有 expiresAt 字段）。
   * JSON 类缓存按契约都有有限 TTL，无过期元数据说明是重构回归期间的脏数据——
   * 签名 URL 早已过期，必须失效让上层重新解析。二进制保持永久兼容旧行为。
   */
  legacyNoExpiry?: boolean
}

/** 内容判定：JSON 按形态（数组=歌曲列表 / 含 url 字符串=URL 条目），二进制按文件头。 */
function classifyEntry(key: string, data: Uint8Array): EntryKind {
  if (cacheKeyType(key) === 'json') {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(data))
      if (Array.isArray(parsed)) return 'songs'
      if (parsed && typeof parsed === 'object' && typeof (parsed as { url?: unknown }).url === 'string') {
        return 'urls'
      }
      return 'songs'
    } catch {
      return 'other'
    }
  }
  const header = data.subarray(0, 16)
  if (isImageBytes(header)) return 'covers'
  if (isAudioBytes(header)) return 'audio'
  return 'audio'
}

/**
 * 桌面磁盘缓存后端（L2）。
 *
 * #410 三条纪律：
 * 1. **真异步**：此前 `async read/write` 内部全是 `fs.*Sync`——播放解析与封面刷新
 *    读的正是这条路径，与 IPC、下载、托盘抢同一个事件循环。现在一律 `fs/promises`。
 * 2. **串行写队列**：写入排队，避免并发写同一路径互相踩、元数据与数据不一致。
 * 3. **O(1) 统计**：`stats()` 从内存索引读取增量记账结果；索引在启动时装载一次
 *    （旧 meta 缺 `kind` 的那一批在这一趟里补判，保证与旧统计口径一致）。
 */
export class DiskCacheBackend implements CacheBackend {
  private cacheDir: string
  private metaDir: string

  /** hash → 元数据（内存索引；stats() 的唯一数据源） */
  private index = new Map<string, MetaRecord>()
  private totalSize = 0
  private counts: Record<EntryKind, number> = { songs: 0, urls: 0, covers: 0, audio: 0, other: 0 }

  private indexReady: Promise<void> | null = null
  /** 写队列：所有落盘串行执行 */
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir
    this.metaDir = path.join(cacheDir, 'meta')
    // 构造时预热（不阻塞启动）；公开方法各自 await，stats() 保持同步契约
    void this.ensureIndex().catch(() => undefined)
  }

  /** 索引装载完成（IPC 取统计前 await，保证首次调用就不是空表）。 */
  ensureIndexReady(): Promise<void> {
    return this.ensureIndex()
  }

  private ensureIndex(): Promise<void> {
    if (!this.indexReady) this.indexReady = this.loadIndex()
    return this.indexReady
  }

  private async loadIndex(): Promise<void> {
    await this.ensureDirs()
    let files: string[] = []
    try {
      files = await fsp.readdir(this.metaDir)
    } catch {
      files = []
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const hash = file.slice(0, -'.json'.length)
      try {
        const raw = JSON.parse(await fsp.readFile(path.join(this.metaDir, file), 'utf-8')) as {
          key?: unknown
          size?: unknown
          expiresAt?: unknown
          kind?: unknown
        }
        if (typeof raw.key !== 'string') continue
        const record: MetaRecord = {
          key: raw.key,
          size: typeof raw.size === 'number' ? raw.size : 0,
          expiresAt: typeof raw.expiresAt === 'number' && raw.expiresAt > 0 ? raw.expiresAt : 0,
          kind: 'other',
        }
        if (typeof raw.expiresAt !== 'number') record.legacyNoExpiry = true
        // 旧 meta 没有 kind：这一趟补判，之后 stats() 就是纯内存读数
        record.kind = ENTRY_KINDS.includes(raw.kind as EntryKind)
          ? (raw.kind as EntryKind)
          : await this.classifyFromDisk(record.key, hash)
        this.index.set(hash, record)
      } catch {
        // 坏 meta 跳过（与旧 stats() 的 catch 行为一致）
      }
    }
    this.recount()
  }

  /** 旧 meta 补判：JSON 读全文解析，二进制只读 16 字节文件头。 */
  private async classifyFromDisk(key: string, hash: string): Promise<EntryKind> {
    const type = cacheKeyType(key)
    const filePath = path.join(this.cacheDir, type, hash)
    try {
      if (type === 'json') {
        const buf = await fsp.readFile(filePath)
        return classifyEntry(key, new Uint8Array(buf))
      }
      const handle = await fsp.open(filePath, 'r')
      try {
        const buf = Buffer.alloc(16)
        const { bytesRead } = await handle.read(buf, 0, 16, 0)
        const header = buf.subarray(0, bytesRead)
        if (isImageBytes(header)) return 'covers'
        return 'audio'
      } finally {
        await handle.close()
      }
    } catch {
      return 'other'
    }
  }

  private async ensureDirs(): Promise<void> {
    await fsp.mkdir(path.join(this.cacheDir, 'json'), { recursive: true })
    await fsp.mkdir(path.join(this.cacheDir, 'bin'), { recursive: true })
    await fsp.mkdir(this.metaDir, { recursive: true })
  }

  /** 写队列：串行执行，且单次失败不会短路后续写入。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private hashKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex')
  }

  private resolvePath(key: string): string {
    return path.join(this.cacheDir, cacheKeyType(key), this.hashKey(key))
  }

  private metaPath(hash: string): string {
    return path.join(this.metaDir, `${hash}.json`)
  }

  /** O(1) 增量记账：摘掉旧记录的贡献，挂上新记录的贡献。 */
  private applyRecord(hash: string, next: MetaRecord | null): void {
    const prev = this.index.get(hash)
    if (prev) {
      this.totalSize -= prev.size
      this.counts[prev.kind]--
      this.index.delete(hash)
    }
    if (next) {
      this.index.set(hash, next)
      this.totalSize += next.size
      this.counts[next.kind]++
    }
  }

  /** 全量重算（只在索引装载后调用一次）。 */
  private recount(): void {
    this.totalSize = 0
    this.counts = { songs: 0, urls: 0, covers: 0, audio: 0, other: 0 }
    for (const record of this.index.values()) {
      this.totalSize += record.size
      this.counts[record.kind]++
    }
  }

  /**
   * 索引里没有该条目的兜底：直接读一次 meta 文件。
   *
   * 为什么需要：索引是**装载那一刻**的快照。若 meta 是装载之后才出现的
   *（旧版本残留、外部写入、或版本交错），只看索引就会绕过 TTL 与旧格式判定，
   * 把早该失效的签名 URL 当成命中返回。真实场景里这条路径几乎不触发——
   * 应用自己写的每一条都走 `write()` 增量记账。
   */
  private async readMetaFromDisk(hash: string): Promise<MetaRecord | undefined> {
    try {
      const raw = JSON.parse(await fsp.readFile(this.metaPath(hash), 'utf-8')) as {
        key?: unknown
        size?: unknown
        expiresAt?: unknown
        kind?: unknown
      }
      if (typeof raw.key !== 'string') return undefined
      const record: MetaRecord = {
        key: raw.key,
        size: typeof raw.size === 'number' ? raw.size : 0,
        expiresAt: typeof raw.expiresAt === 'number' && raw.expiresAt > 0 ? raw.expiresAt : 0,
        kind: ENTRY_KINDS.includes(raw.kind as EntryKind) ? (raw.kind as EntryKind) : 'other',
      }
      if (typeof raw.expiresAt !== 'number') record.legacyNoExpiry = true
      return record
    } catch {
      return undefined
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    await this.ensureIndex()
    const hash = this.hashKey(key)
    const meta = this.index.get(hash) ?? (await this.readMetaFromDisk(hash))
    const now = Date.now()
    // TTL 过期：删除并视为未命中（重新获取）
    if (meta && meta.expiresAt > 0 && now >= meta.expiresAt) {
      await this.delete(key)
      return null
    }
    // 旧格式 JSON 条目：无过期元数据视为脏数据，失效让上层重新解析
    if (meta?.legacyNoExpiry && cacheKeyType(key) === 'json') {
      await this.delete(key)
      return null
    }
    try {
      return new Uint8Array(await fsp.readFile(this.resolvePath(key)))
    } catch {
      // 数据文件缺失（只剩 meta）：按未命中处理
      return null
    }
  }

  async write(key: string, data: Uint8Array, expiresAt?: number): Promise<void> {
    await this.ensureIndex()
    await this.enqueue(async () => {
      const filePath = this.resolvePath(key)
      const hash = this.hashKey(key)
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.writeFile(filePath, data)

      const record: MetaRecord = {
        key,
        size: data.byteLength,
        expiresAt: expiresAt && expiresAt > 0 ? expiresAt : 0,
        kind: classifyEntry(key, data),
      }
      try {
        await fsp.writeFile(this.metaPath(hash), JSON.stringify(record))
      } catch (error) {
        console.error('写入缓存元数据失败:', error)
      }
      this.applyRecord(hash, record)
    })
  }

  async getExpiryAt(key: string): Promise<number> {
    await this.ensureIndex()
    const hash = this.hashKey(key)
    const meta = this.index.get(hash) ?? (await this.readMetaFromDisk(hash))
    return meta && meta.expiresAt > 0 ? meta.expiresAt : 0
  }

  async delete(key: string): Promise<void> {
    await this.ensureIndex()
    await this.enqueue(async () => {
      const hash = this.hashKey(key)
      await fsp.rm(this.resolvePath(key), { force: true })
      await fsp.rm(this.metaPath(hash), { force: true })
      this.applyRecord(hash, null)
    })
  }

  async clear(): Promise<void> {
    await this.ensureIndex()
    await this.enqueue(async () => {
      await fsp.rm(path.join(this.cacheDir, 'json'), { recursive: true, force: true })
      await fsp.rm(path.join(this.cacheDir, 'bin'), { recursive: true, force: true })
      await fsp.rm(this.metaDir, { recursive: true, force: true })
      await this.ensureDirs()
      this.index.clear()
      this.recount()
    })
  }

  async keys(): Promise<string[]> {
    await this.ensureIndex()
    return [...this.index.values()].map((record) => record.key)
  }

  /** O(1)：纯内存读数，不触碰磁盘（#410：此前是 O(文件数) 的同步递归遍历）。 */
  stats(): CacheStats {
    const entries = this.index.size
    return {
      hits: 0,
      misses: 0,
      entries,
      totalSize: this.totalSize,
      fileCount: entries,
      songsCount: this.counts.songs,
      coversCount: this.counts.covers,
      audioCount: this.counts.audio,
      urlsCount: this.counts.urls,
    }
  }

  getFilePath(key: string): string {
    return this.resolvePath(key)
  }
}
