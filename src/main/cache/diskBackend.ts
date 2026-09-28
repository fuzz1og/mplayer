import fsp from 'fs/promises'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Transform, pipeline } from 'stream'
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
  /** meta 里没有（或不是合法）kind，需要在索引装载时按内容补判一次。 */
  needsClassify?: boolean
  /**
   * 旧格式条目（缓存统一重构前写入，meta 里没有 expiresAt 字段）。
   * JSON 类缓存按契约都有有限 TTL，无过期元数据说明是重构回归期间的脏数据——
   * 签名 URL 早已过期，必须失效让上层重新解析。二进制保持永久兼容旧行为。
   */
  legacyNoExpiry?: boolean
}

/** meta 文件内容 → 索引记录（装载与兜底读取共用，避免同一解析写两遍）。 */
function parseMetaRecord(raw: unknown): MetaRecord | null {
  const value = raw as { key?: unknown; size?: unknown; expiresAt?: unknown; kind?: unknown } | null
  if (!value || typeof value.key !== 'string') return null
  const record: MetaRecord = {
    key: value.key,
    size: typeof value.size === 'number' ? value.size : 0,
    expiresAt: typeof value.expiresAt === 'number' && value.expiresAt > 0 ? value.expiresAt : 0,
    kind: ENTRY_KINDS.includes(value.kind as EntryKind) ? (value.kind as EntryKind) : 'other',
  }
  if (typeof value.expiresAt !== 'number') record.legacyNoExpiry = true
  if (!ENTRY_KINDS.includes(value.kind as EntryKind)) record.needsClassify = true
  return record
}

/** 内容判定：JSON 按形态（数组=歌曲列表 / 含 url 字符串=URL 条目），二进制按文件头（都不是时归 audio，与旧 stats 一致）。 */
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

/** 流式写入的临时文件后缀：不属于索引，崩溃残留由索引装载时清扫（#426）。 */
const STREAM_TEMP_SUFFIX = '.tmp'
/** 分类所需的头部字节：二进制条目只按文件头判定（与 `classifyEntry` 的二进制分支同源）。 */
const BINARY_CLASSIFY_BYTES = 16

/** 流式写入的产出：落盘字节数 + 二进制分类所需的头部（不回读、不整段驻留内存）。 */
interface StreamedEntry {
  size: number
  head: Buffer
}

/**
 * 流式条目的分类：与 `write()` **完全一致，无例外**。
 *
 * 二进制只按文件头判定；JSON 要整份 `parse` 才分得出 `songs`/`urls`，所以这里回读**已经
 * 落盘的临时文件**、用同一个 `classifyEntry` 量一遍（临时文件本来就要写；流式的收益在大
 * 二进制腿，JSON 条目本身很小）。曾按「头部被上限截断就归 other」处理——那会让同一份 JSON
 * 经 `writeFromStream` 落盘后在 `stats()`/`keys()` 里与 `write()` 不一致（记账退化）。
 */
async function classifyStreamedEntry(key: string, entry: StreamedEntry, tempPath: string): Promise<EntryKind> {
  if (cacheKeyType(key) === 'json') {
    return classifyEntry(key, new Uint8Array(await fsp.readFile(tempPath)))
  }
  return classifyEntry(key, entry.head)
}

/**
 * 把可读流原样写进 `filePath`，边写边统计字节数并留一份头部（#426）。
 *
 * 用 `pipeline` 而不是手接 data/error：任一侧出错时它会**销毁上游**（下载流不会被留在
 * 半路继续拉数据），并把错误原样抛给调用方。
 */
function pipeToFile(source: NodeJS.ReadableStream, filePath: string, headLimit: number): Promise<StreamedEntry> {
  return new Promise((resolve, reject) => {
    let size = 0
    let head = Buffer.alloc(0)
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (head.length < headLimit) {
          head = Buffer.concat([head, chunk.subarray(0, headLimit - head.length)])
        }
        callback(null, chunk)
      },
    })
    pipeline(source, meter, fs.createWriteStream(filePath), (error) => {
      if (error) reject(error)
      else resolve({ size, head })
    })
  })
}

/** 中断时掐掉上游：调用方（如 axios 流）不该在写入失败后继续拉数据。 */
function destroySource(source: NodeJS.ReadableStream): void {
  const destroyable = source as { destroy?: () => void }
  if (typeof destroyable.destroy === 'function') destroyable.destroy()
}

/** `writeFromStream` 的选项：语义与 `write()` 的第三参一致。 */
export interface WriteFromStreamOptions {
  /** 绝对过期时间戳（ms）；0 / undefined 表示永不过期。 */
  expiresAt?: number
}

/**
 * 一个缓存目录的**全进程共享状态**。
 *
 * 为什么必须共享：`main.ts` 与 `ipc/cache.ts` 各自 new 了一个 `DiskCacheBackend`，
 * 指向**同一个** `userData/cache`（前者写汽水音频 `bin:soda:*`）。索引如果按实例各持
 * 一份，A 写的条目在 B 的 `stats()`/`keys()` 里就永远看不见——而改成索引之前的实现是
 * 现遍历目录，能统计到。共享之后两个实例等价于同一份视图。
 *
 * 共享的还有写队列（两个实例写同一目录也要串行）与目录初始化。
 */
class SharedCacheIndex {
  readonly index = new Map<string, MetaRecord>()
  totalSize = 0
  counts: Record<EntryKind, number> = { songs: 0, urls: 0, covers: 0, audio: 0, other: 0 }
  private ready: Promise<void> | null = null
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly cacheDir: string,
    readonly metaDir: string,
  ) {}

  metaPath(hash: string): string {
    return path.join(this.metaDir, `${hash}.json`)
  }

  dataPath(key: string, hash: string): string {
    return path.join(this.cacheDir, cacheKeyType(key), hash)
  }

  ensureIndex(): Promise<void> {
    if (!this.ready) this.ready = this.loadIndex()
    return this.ready
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async ensureDirs(): Promise<void> {
    await fsp.mkdir(path.join(this.cacheDir, 'json'), { recursive: true })
    await fsp.mkdir(path.join(this.cacheDir, 'bin'), { recursive: true })
    await fsp.mkdir(this.metaDir, { recursive: true })
  }

  private async loadIndex(): Promise<void> {
    await this.ensureDirs()
    await this.sweepStreamTemps()
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
        const record = parseMetaRecord(JSON.parse(await fsp.readFile(this.metaPath(hash), 'utf-8')))
        if (!record) continue
        if (record.needsClassify) {
          // 旧 meta 没有 kind：这一趟补判，之后 stats() 就是纯内存读数。
          // 数据文件也不在了（只剩 meta 的幽灵条目）→ 整条跳过，与旧 stats() 只看实际文件的
          // 口径一致（旧实现里它根本不进 fileCount）。
          const kind = await this.classifyFromDisk(record.key, hash)
          if (!kind) continue
          record.kind = kind
          delete record.needsClassify
        }
        this.index.set(hash, record)
      } catch {
        // 坏 meta 跳过（与旧 stats() 的 catch 行为一致）
      }
    }
    this.recount()
  }

  /**
   * 清扫崩溃残留的流式临时文件（#426）。
   *
   * 跑在索引装载这一刻：**本进程**的写入方都要先 `await ensureIndex()`，所以本进程不会
   * 有正在写的临时文件；上一个进程被杀留下的那半个文件在这里消失，「中断不留半个文件」在
   * 崩溃场景下也成立。
   *
   * 口径限定：多实例共享同一份 userData（同一 cacheDir）时不成立——另一个进程可能正写到
   * 一半，它的临时文件会被这里误删（那次下载随即失败并由调用方回退直链，不会留下半成品）。
   * 原先注释断言的是「不可能」，而那只对**单实例**成立，故在此写明前提。
   */
  private async sweepStreamTemps(): Promise<void> {
    for (const type of ['json', 'bin']) {
      const dir = path.join(this.cacheDir, type)
      let files: string[] = []
      try {
        files = await fsp.readdir(dir)
      } catch {
        continue
      }
      await Promise.all(
        files
          .filter((file) => file.endsWith(STREAM_TEMP_SUFFIX))
          .map((file) => fsp.rm(path.join(dir, file), { force: true }).catch(() => undefined)),
      )
    }
  }

  /**
   * 旧 meta 补判：JSON 读全文解析（解析不了归 'other'，与旧 stats 的 catch 一致），
   * 二进制只读 16 字节文件头（都不是归 'audio'，同旧口径）。
   * 数据文件不存在 → 返回 undefined，调用方跳过该幽灵条目。
   */
  private async classifyFromDisk(key: string, hash: string): Promise<EntryKind | undefined> {
    const filePath = this.dataPath(key, hash)
    try {
      if (cacheKeyType(key) === 'json') {
        return classifyEntry(key, new Uint8Array(await fsp.readFile(filePath)))
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
      return undefined
    }
  }

  /**
   * 索引里没有该条目的兜底：直接读一次 meta 文件。
   *
   * 为什么需要：索引是**装载那一刻**的快照。若 meta 是装载之后才出现的
   *（旧版本残留、外部写入、或版本交错），只看索引就会绕过 TTL 与旧格式判定，
   * 把早该失效的签名 URL 当成命中返回。
   */
  async readMetaFromDisk(hash: string): Promise<MetaRecord | undefined> {
    try {
      const record = parseMetaRecord(JSON.parse(await fsp.readFile(this.metaPath(hash), 'utf-8')))
      return record ?? undefined
    } catch {
      return undefined
    }
  }

  /** O(1) 增量记账：摘掉旧记录的贡献，挂上新记录的贡献。 */
  applyRecord(hash: string, next: MetaRecord | null): void {
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

  /** 全量重算（只在索引装载后或清空后调用）。 */
  recount(): void {
    this.totalSize = 0
    this.counts = { songs: 0, urls: 0, covers: 0, audio: 0, other: 0 }
    for (const record of this.index.values()) {
      this.totalSize += record.size
      this.counts[record.kind]++
    }
  }
}

/** cacheDir → 共享状态。同一目录无论 new 几次后端，都是同一份索引与写队列。 */
const sharedIndexes = new Map<string, SharedCacheIndex>()

function sharedIndexFor(cacheDir: string): SharedCacheIndex {
  let shared = sharedIndexes.get(cacheDir)
  if (!shared) {
    shared = new SharedCacheIndex(cacheDir, path.join(cacheDir, 'meta'))
    sharedIndexes.set(cacheDir, shared)
  }
  return shared
}

/**
 * 桌面磁盘缓存后端（L2）。
 *
 * #410 三条纪律：
 * 1. **真异步**：此前 `async read/write` 内部全是 `fs.*Sync`——播放解析与封面刷新
 *    读的正是这条路径，与 IPC、下载、托盘抢同一个事件循环。现在一律 `fs/promises`。
 * 2. **串行写队列**：写入排队，避免并发写同一路径互相踩、元数据与数据不一致。
 * 3. **O(1) 统计**：`stats()` 从共享内存索引读取增量记账结果；索引在启动时装载一次
 *    （旧 meta 缺 `kind` 的那一批在这一趟里补判，保证与旧统计口径一致）。
 */
export class DiskCacheBackend implements CacheBackend {
  private cacheDir: string
  private metaDir: string
  private shared: SharedCacheIndex

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir
    this.metaDir = path.join(cacheDir, 'meta')
    this.shared = sharedIndexFor(cacheDir)
    // 构造时预热（不阻塞启动）；公开方法各自 await，stats() 保持同步契约
    void this.shared.ensureIndex().catch(() => undefined)
  }

  /** 索引装载完成（IPC 取统计前 await，保证首次调用就不是空表）。 */
  ensureIndexReady(): Promise<void> {
    return this.shared.ensureIndex()
  }

  private hashKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex')
  }

  private resolvePath(key: string): string {
    return this.shared.dataPath(key, this.hashKey(key))
  }

  private metaPath(hash: string): string {
    return this.shared.metaPath(hash)
  }

  async read(key: string): Promise<Uint8Array | null> {
    await this.shared.ensureIndex()
    const hash = this.hashKey(key)
    const meta = this.shared.index.get(hash) ?? (await this.shared.readMetaFromDisk(hash))
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
    await this.shared.ensureIndex()
    await this.shared.enqueue(async () => {
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
      this.shared.applyRecord(hash, record)
    })
  }

  /**
   * 流式写入（#426）：边收边写临时文件 → 完成后**原子 rename** → 由后端写 meta 并记账。
   *
   * 与 `write()` 的语义对齐：同一 key 规则（同一 hash、同一 json/bin 目录）、同一份 meta
   * 记账、同一个共享写队列。区别只在**队列只圈住收尾那一步**——整段下载若占着队列，会把
   * 其它缓存写饿死几十秒。临时文件名带随机后缀，同一 key 的并发流式写各写各的，不互相截断。
   *
   * `kind`/`size`/记账与 `write()` **完全一致，无例外**：JSON 条目也由同一把 `classifyEntry`
   * 判定（见 `classifyStreamedEntry`），不存在「只有流式才会出现」的分类。
   *
   * 中断（source 抛错 / 被 destroy / 磁盘写失败）只删临时文件：最终路径与 meta 一个字节
   * 不动，于是 `stats()`/`keys()` 里既看不到半成品条目，也不留孤儿记账；目标 key 上原有
   * 的旧条目也原样保留。
   */
  async writeFromStream(
    key: string,
    source: NodeJS.ReadableStream,
    opts: WriteFromStreamOptions = {},
  ): Promise<void> {
    await this.shared.ensureIndex()
    const hash = this.hashKey(key)
    const filePath = this.resolvePath(key)
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${crypto.randomUUID()}${STREAM_TEMP_SUFFIX}`

    let record: MetaRecord
    try {
      const payload = await pipeToFile(source, tempPath, BINARY_CLASSIFY_BYTES)
      record = {
        key,
        size: payload.size,
        expiresAt: opts.expiresAt && opts.expiresAt > 0 ? opts.expiresAt : 0,
        // 分类在 rename 之前完成：JSON 条目要整份 parse，读的就是这个已落盘的临时文件
        kind: await classifyStreamedEntry(key, payload, tempPath),
      }
    } catch (error) {
      destroySource(source)
      await fsp.rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
    try {
      await this.shared.enqueue(async () => {
        await fsp.rename(tempPath, filePath)
        try {
          await fsp.writeFile(this.metaPath(hash), JSON.stringify(record))
        } catch (error) {
          console.error('写入缓存元数据失败:', error)
        }
        this.shared.applyRecord(hash, record)
      })
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async getExpiryAt(key: string): Promise<number> {
    await this.shared.ensureIndex()
    const hash = this.hashKey(key)
    const meta = this.shared.index.get(hash) ?? (await this.shared.readMetaFromDisk(hash))
    return meta && meta.expiresAt > 0 ? meta.expiresAt : 0
  }

  async delete(key: string): Promise<void> {
    await this.shared.ensureIndex()
    await this.shared.enqueue(async () => {
      const hash = this.hashKey(key)
      await fsp.rm(this.resolvePath(key), { force: true })
      await fsp.rm(this.metaPath(hash), { force: true })
      this.shared.applyRecord(hash, null)
    })
  }

  async clear(): Promise<void> {
    await this.shared.ensureIndex()
    await this.shared.enqueue(async () => {
      await fsp.rm(path.join(this.cacheDir, 'json'), { recursive: true, force: true })
      await fsp.rm(path.join(this.cacheDir, 'bin'), { recursive: true, force: true })
      await fsp.rm(this.metaDir, { recursive: true, force: true })
      await this.shared.ensureDirs()
      this.shared.index.clear()
      this.shared.recount()
    })
  }

  async keys(): Promise<string[]> {
    await this.shared.ensureIndex()
    return [...this.shared.index.values()].map((record) => record.key)
  }

  /** O(1)：纯内存读数，不触碰磁盘（#410：此前是 O(文件数) 的同步递归遍历）。 */
  stats(): CacheStats {
    const entries = this.shared.index.size
    return {
      hits: 0,
      misses: 0,
      entries,
      totalSize: this.shared.totalSize,
      fileCount: entries,
      songsCount: this.shared.counts.songs,
      coversCount: this.shared.counts.covers,
      audioCount: this.shared.counts.audio,
      urlsCount: this.shared.counts.urls,
    }
  }

  getFilePath(key: string): string {
    return this.resolvePath(key)
  }
}
