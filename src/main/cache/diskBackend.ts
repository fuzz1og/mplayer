import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { CacheBackend } from '@mplayer/core'

export class DiskCacheBackend implements CacheBackend {
  private cacheDir: string

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir
    fs.mkdirSync(path.join(cacheDir, 'json'), { recursive: true })
    fs.mkdirSync(path.join(cacheDir, 'bin'), { recursive: true })
  }

  private hashKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex')
  }

  private resolvePath(key: string): string {
    const type = key.startsWith('json:') ? 'json' : 'bin'
    const hash = this.hashKey(key)
    return path.join(this.cacheDir, type, hash)
  }

  async read(key: string): Promise<Uint8Array | null> {
    const filePath = this.resolvePath(key)
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath)
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    const filePath = this.resolvePath(key)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, data)
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
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
  }

  async keys(): Promise<string[]> {
    // Disk backend doesn't track keys externally (no index file needed)
    // Keys are derived from filenames if needed
    return []
  }
}