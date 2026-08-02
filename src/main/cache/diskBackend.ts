import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { CacheBackend, CacheStats } from '@mplayer/core'

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

  async read(key: string): Promise<Uint8Array | null> {
    const filePath = this.resolvePath(key)
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath)
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    const filePath = this.resolvePath(key)
    const hash = this.hashKey(key)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, data)
    try {
      fs.writeFileSync(this.metaPath(hash), JSON.stringify({ key, size: data.byteLength }))
    } catch (error) {
      console.error('写入缓存元数据失败:', error)
    }
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
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return true
    if (header.length >= 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return true
    if (header.length >= 12 && header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) return true
    if (header.length >= 6 && header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return true
    return false
  }

  private isAudio(header: Buffer): boolean {
    if (header.length >= 3 && header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) return true
    if (header.length >= 4 && header[0] === 0x66 && header[1] === 0x4c && header[2] === 0x61 && header[3] === 0x43) return true
    if (header.length >= 4 && header[0] === 0x4f && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) return true
    if (header.length >= 12 && header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return true
    if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return true
    return false
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
