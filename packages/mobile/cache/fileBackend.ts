import { cacheDirectory, readAsStringAsync, writeAsStringAsync, makeDirectoryAsync, deleteAsync } from 'expo-file-system'
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
    return []
  }
}