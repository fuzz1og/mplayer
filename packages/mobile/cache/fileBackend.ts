import { cacheDirectory, readAsStringAsync, writeAsStringAsync, makeDirectoryAsync, deleteAsync, readDirectoryAsync, getInfoAsync } from 'expo-file-system/legacy'
import { md5 } from '@mplayer/core'
import type { CacheBackend } from '@mplayer/core'

export class MobileFileBackend implements CacheBackend {
  private baseDir: string

  constructor() {
    this.baseDir = `${cacheDirectory}/mplayer-cache`
  }

  private hashKey(key: string): string {
    return md5(key)
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
    // 分块转 base64：大数组直接 spread 到 String.fromCharCode 会爆调用栈（RangeError），
    // 歌词/封面等大 payload 进入 L2 缓存时也不能崩
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < data.length; i += CHUNK) {
      binary += String.fromCharCode(...data.subarray(i, i + CHUNK))
    }
    const base64 = btoa(binary)
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

  /**
   * 注意：本后端用单向 hash 做文件名，无法从文件名反推原始 key，
   * 因此 keys() 返回的"伪 key"不能传给 remove()（会把 hash 再 hash，永远删不到）。
   * 当前无调用方依赖它（设置页用 getDiskStats/clear），仅保持接口完整。
   */
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
