import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { isImageBytes, isAudioBytes, type CacheBackend, type CacheStats } from '@mplayer/core'

/**
 * 校验缓存文件是否为有效图片（JPEG/PNG/WebP/GIF/AVIF/ICO/BMP）。损坏或非图片
 * 返回 false。字节判定走 core sniffers 单点（ADR-0002），此处仅负责读文件头。
 */
export function isImageFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(16)
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0)
    return isImageBytes(buf.subarray(0, bytesRead))
  } finally {
    fs.closeSync(fd)
  }
}

export class DiskCacheBackend implements CacheBackend {
  private cacheDir: string
  private metaDir: string

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir
    this.metaDir = path.join(cacheDir, 'meta')
    fs.mkdirSync(path.join(cacheDir, 'json'), { recursive: true })
    fs.mkdirSync(path.join(cacheDir, 'bin'), { recursive: true })
    fs.mkdirSync(this.metaDir, { recursive: true })
  }

  private hashKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex')
  }

  private resolvePath(key: string): string {
    const type = key.startsWith('json:') ? 'json' : 'bin'
    const hash = this.hashKey(key)
    return path.join(this.cacheDir, type, hash)
  }

  private metaPath(hash: string): string {
    return path.join(this.metaDir, `${hash}.json`)
  }

  private readMeta(hash: string): { key?: string; size?: number; expiresAt?: number } | null {
    const metaFile = this.metaPath(hash)
    if (!fs.existsSync(metaFile)) return null
    try {
      return JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
    } catch {
      return null
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    const filePath = this.resolvePath(key)
    if (!fs.existsSync(filePath)) return null
    const hash = this.hashKey(key)
    const meta = this.readMeta(hash)
    const now = Date.now()
    // TTL 过期：删除并视为未命中（重新获取）
    if (meta?.expiresAt && meta.expiresAt > 0 && now >= meta.expiresAt) {
      await this.delete(key)
      return null
    }
    // 旧格式条目（缓存统一重构前写入，meta 无 expiresAt 字段）：
    // JSON 类缓存（URL/搜索）按契约都有有限 TTL，无过期元数据说明是
    // 重构回归期间写入的脏数据——签名 URL 早已过期，必须失效让上层重新解析；
    // 二进制（音频/封面）保持永久兼容旧行为。
    if (meta?.expiresAt === undefined && key.startsWith(':json:')) {
      await this.delete(key)
      return null
    }
    return fs.readFileSync(filePath)
  }

  async write(key: string, data: Uint8Array, expiresAt?: number): Promise<void> {
    const filePath = this.resolvePath(key)
    const hash = this.hashKey(key)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, data)
    try {
      fs.writeFileSync(
        this.metaPath(hash),
        JSON.stringify({
          key,
          size: data.byteLength,
          expiresAt: expiresAt && expiresAt > 0 ? expiresAt : 0,
        }),
      )
    } catch (error) {
      console.error('写入缓存元数据失败:', error)
    }
  }

  async getExpiryAt(key: string): Promise<number> {
    const meta = this.readMeta(this.hashKey(key))
    return meta?.expiresAt && meta.expiresAt > 0 ? meta.expiresAt : 0
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    const meta = this.metaPath(this.hashKey(key))
    if (fs.existsSync(meta)) fs.unlinkSync(meta)
  }

  async clear(): Promise<void> {
    const removeDir = (dir: string) => {
      if (!fs.existsSync(dir)) return
      fs.readdirSync(dir).forEach(file => {
        const p = path.join(dir, file)
        if (fs.lstatSync(p).isDirectory()) removeDir(p)
        else fs.unlinkSync(p)
      })
    }
    removeDir(path.join(this.cacheDir, 'json'))
    removeDir(path.join(this.cacheDir, 'bin'))
    removeDir(this.metaDir)
    fs.mkdirSync(path.join(this.cacheDir, 'json'), { recursive: true })
    fs.mkdirSync(path.join(this.cacheDir, 'bin'), { recursive: true })
    fs.mkdirSync(this.metaDir, { recursive: true })
  }

  async keys(): Promise<string[]> {
    if (!fs.existsSync(this.metaDir)) return []
    return fs.readdirSync(this.metaDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.metaDir, file), 'utf-8')).key as string
        } catch {
          return null
        }
      })
      .filter((key): key is string => Boolean(key))
  }

  private walkFiles(dir: string): { path: string; size: number }[] {
    if (!fs.existsSync(dir)) return []
    const results: { path: string; size: number }[] = []
    fs.readdirSync(dir).forEach(file => {
      const p = path.join(dir, file)
      const stat = fs.lstatSync(p)
      if (stat.isDirectory()) {
        results.push(...this.walkFiles(p))
      } else {
        results.push({ path: p, size: stat.size })
      }
    })
    return results
  }

  private readHeader(filePath: string): Buffer {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(16)
      const bytesRead = fs.readSync(fd, buf, 0, 16, 0)
      return buf.subarray(0, bytesRead)
    } finally {
      fs.closeSync(fd)
    }
  }

  private isImage(header: Buffer): boolean {
    return isImageBytes(header)
  }

  private isAudio(header: Buffer): boolean {
    return isAudioBytes(header)
  }

  stats(): CacheStats {
    const jsonFiles = this.walkFiles(path.join(this.cacheDir, 'json'))
    const binFiles = this.walkFiles(path.join(this.cacheDir, 'bin'))
    const fileCount = jsonFiles.length + binFiles.length
    const totalSize = [...jsonFiles, ...binFiles].reduce((sum, file) => sum + file.size, 0)

    let songsCount = 0
    let coversCount = 0
    let audioCount = 0
    let urlsCount = 0

    for (const file of jsonFiles) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file.path, 'utf-8'))
        if (Array.isArray(parsed)) {
          songsCount++
        } else if (parsed && typeof parsed === 'object' && typeof parsed.url === 'string') {
          urlsCount++
        } else {
          songsCount++
        }
      } catch {
        // 无法解析的 JSON 文件仍计入 fileCount
      }
    }

    for (const file of binFiles) {
      const header = this.readHeader(file.path)
      if (this.isImage(header)) {
        coversCount++
      } else if (this.isAudio(header)) {
        audioCount++
      } else {
        audioCount++
      }
    }

    return {
      hits: 0,
      misses: 0,
      entries: fileCount,
      totalSize,
      fileCount,
      songsCount,
      coversCount,
      audioCount,
      urlsCount,
    }
  }

  getFilePath(key: string): string {
    return this.resolvePath(key)
  }
}
