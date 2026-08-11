import fs from 'fs'
import { app } from 'electron'
import path from 'path'
import { registerIpcHandlerSimple } from './registerHandler'
import { CacheKernel, createMemoryBackend } from '@mplayer/core'
import { DiskCacheBackend, isImageFile } from '../cache/diskBackend'

const COVER_CACHE_TTL = 6 * 60 * 60 * 1000

let cacheKernel: CacheKernel | null = null
let diskBackend: DiskCacheBackend | null = null

function getCacheKernel(): CacheKernel {
  if (!cacheKernel) {
    const userDataPath = app.getPath('userData')
    const diskDir = path.join(userDataPath, 'cache')
    diskBackend = new DiskCacheBackend(diskDir)
    cacheKernel = new CacheKernel({
      l1: createMemoryBackend(),
      l2: diskBackend,
    })
  }
  return cacheKernel
}

function getDiskBackend(): DiskCacheBackend {
  getCacheKernel()
  return diskBackend!
}

async function getBinaryCachePath(backendKey: string, ttlMs?: number): Promise<string | null> {
  const filePath = getDiskBackend().getFilePath(backendKey)
  if (!fs.existsSync(filePath)) return null
  if (ttlMs) {
    const stat = fs.statSync(filePath)
    if (Date.now() - stat.mtimeMs > ttlMs) {
      await getDiskBackend().delete(backendKey)
      return null
    }
  }
  return filePath
}

export function registerCacheIpc(): void {
  const kernel = getCacheKernel()

  // New API (typed, for future renderer migration)
  registerIpcHandlerSimple('cache:getJSON', async (key: string) => {
    return kernel.getJSON(key)
  })
  registerIpcHandlerSimple('cache:setJSON', async (key: string, value: any, ttlMs: number) => {
    await kernel.setJSON(key, value, ttlMs)
  })
  registerIpcHandlerSimple('cache:getBinary', async (key: string) => {
    return kernel.getBinary(key)
  })
  registerIpcHandlerSimple('cache:setBinary', async (key: string, data: Uint8Array, ttlMs: number) => {
    await kernel.setBinary(key, data, ttlMs)
  })

  // Legacy compatibility (renderer still uses these channels)
  registerIpcHandlerSimple('cache:getUrl', async (songId: string) => {
    return kernel.getJSON(`url:${songId}`)
  })
  registerIpcHandlerSimple('cache:setUrl', async (songId: string, urlData: any) => {
    // 12h：与重构前 CacheManager.URL_EXPIRE_HOURS 契约一致——
    // 签名 URL 服务端时效短，过期后下次进歌单必须重新搜索拿新签名
    await kernel.setJSON(`url:${songId}`, urlData, 12 * 60 * 60 * 1000)
  })
  registerIpcHandlerSimple('cache:getSong', async (keyword: string) => {
    return kernel.getJSON(`search:${keyword}`)
  })
  registerIpcHandlerSimple('cache:setSong', async (keyword: string, songs: any[]) => {
    await kernel.setJSON(`search:${keyword}`, songs, 6 * 60 * 60 * 1000)
  })
  registerIpcHandlerSimple('cache:getCover', async (coverUrl: string) => {
    const backendKey = `:bin:cover:${coverUrl}`
    const filePath = await getBinaryCachePath(backendKey, COVER_CACHE_TTL)
    if (!filePath) return null
    // 缓存文件损坏或不是有效图片时删除并视为未命中，触发重新获取（默认图绝不落入缓存）
    if (!isImageFile(filePath)) {
      await getDiskBackend().delete(backendKey)
      return null
    }
    return filePath
  })
  registerIpcHandlerSimple('cache:setCover', async (coverUrl: string, imageData: Buffer) => {
    await kernel.setBinary(`cover:${coverUrl}`, new Uint8Array(imageData), COVER_CACHE_TTL)
  })
  registerIpcHandlerSimple('cache:getAudio', async (audioUrl: string) => {
    return getBinaryCachePath(`:bin:audio:${audioUrl}`)
  })
  registerIpcHandlerSimple('cache:setAudio', async (audioUrl: string, audioData: Buffer) => {
    await kernel.setBinary(`audio:${audioUrl}`, new Uint8Array(audioData), 24 * 60 * 60 * 1000)
  })

  registerIpcHandlerSimple('cache:clear', async () => {
    await kernel.clear()
  })
  registerIpcHandlerSimple('cache:getStats', () => {
    return kernel.stats()
  })
}
