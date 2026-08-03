import { cacheDirectory, readAsStringAsync, writeAsStringAsync, makeDirectoryAsync, deleteAsync, readDirectoryAsync, getInfoAsync } from 'expo-file-system/legacy'
import type { CacheBackend } from '@mplayer/core'
import crypto from 'crypto'

export class MobileFileBackend implements CacheBackend {
  private baseDir: string

  constructor() {
    this.baseDir = `${cacheDirectory}/mplayer-cache`
  }

  private hashKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex')
  }

  private resolvePath(key: string): string {
    const type = key.startsWith('json:') ? 'json' : 'bin'
    const hash = this.hashKey(key)
    return `${this.baseDir}/${type}/${hash}`
  }

  async read(key: string): Promise<Uint8Array | null> {
    const filePath = this.resolvePath(key)
    try {
      const base64 = await readAsStringAsync(filePath, { encoding: 'base64' })
      return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    } catch {
      return null
    }
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    const filePath = this.resolvePath(key)
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    await makeDirectoryAsync(dir, { intermediates: true })
    const base64 = btoa(String.fromCharCode(...data))
    await writeAsStringAsync(filePath, base64, { encoding: 'base64' })
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key)
    try {
      await deleteAsync(filePath, { idempotent: true })
    } catch {
      // ignore
    }
  }

  async clear(): Promise<void> {
    await deleteAsync(this.baseDir, { idempotent: true })
  }

  async keys(): Promise<string[]> {
    const keys: string[] = []
    for (const type of ['json', 'bin']) {
      const dir = `${this.baseDir}/${type}`
      try {
        const files = await readDirectoryAsync(dir)
        keys.push(...files.map(f => `${type}:${f}`))
      } catch {
        // 目录不存在 = 无缓存
      }
    }
    return keys
  }

  /** 磁盘占用统计（设置页展示用；CacheBackend.stats 是同步接口，此处独立提供） */
  async getDiskStats(): Promise<{ fileCount: number; totalSize: number }> {
    let fileCount = 0
    let totalSize = 0
    for (const type of ['json', 'bin']) {
      const dir = `${this.baseDir}/${type}`
      try {
        const files = await readDirectoryAsync(dir)
        for (const f of files) {
          try {
            const info = await getInfoAsync(`${dir}/${f}`)
            if (info.exists && !info.isDirectory) {
              fileCount++
              totalSize += info.size || 0
            }
          } catch {
            // 单个文件统计失败不影响整体
          }
        }
      } catch {
        // 目录不存在 = 无缓存
      }
    }
    return { fileCount, totalSize }
  }
}
