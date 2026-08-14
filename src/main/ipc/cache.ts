import fs from 'fs'
import { app } from 'electron'
import path from 'path'
import axios from 'axios'
import { registerIpcHandlerSimple } from './registerHandler'
import { CacheKernel, createMemoryBackend, resourceUrlKey } from '@mplayer/core'
import { DiskCacheBackend, isImageBytes, isImageFile } from '../cache/diskBackend'

const COVER_CACHE_TTL = 6 * 60 * 60 * 1000
// 签名 URL 服务端时效短：12h 过期后下次进歌单必须重新搜索拿新签名
const URL_CACHE_TTL_MS = 12 * 60 * 60 * 1000

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

/**
 * 主进程侧封面落盘缓存：渲染层无会话 cookie，直接 fetch 受保护封面端点
 * 永远拿不到图（服务端返回错误页），改为在解析出 CDN 直链后由主进程
 * 下载真实图片字节写入磁盘缓存（以原始封面 URL 为键），下次渲染直接
 * 命中 file://，不再重复打上游。失败静默（不影响解析结果，渲染走 CDN）。
 */
export async function cacheResolvedCover(originalUrl: string, cdnUrl: string): Promise<void> {
  try {
    const res = await axios.get(cdnUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      proxy: false,
    });
    const buf = Buffer.from(res.data);
    if (!isImageBytes(buf)) return;
    // 缓存 key 用归一化 URL（忽略 t/sign 等签名参数）：同一首歌每次搜索签名
    // 不同，但封面是同一资源——归一化后共享同一磁盘项，避免重复下载/堆积
    await getCacheKernel().setBinary(`cover:${resourceUrlKey(originalUrl)}`, new Uint8Array(buf), COVER_CACHE_TTL);
  } catch {
    // 封面缓存失败不影响解析结果
  }
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
    await kernel.setJSON(`url:${songId}`, urlData, URL_CACHE_TTL_MS)
  })
  registerIpcHandlerSimple('cache:getSong', async (keyword: string) => {
    return kernel.getJSON(`search:${keyword}`)
  })
  registerIpcHandlerSimple('cache:setSong', async (keyword: string, songs: any[]) => {
    await kernel.setJSON(`search:${keyword}`, songs, 6 * 60 * 60 * 1000)
  })
  registerIpcHandlerSimple('cache:getCover', async (coverUrl: string) => {
    const backendKey = `:bin:cover:${resourceUrlKey(coverUrl)}`
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
    await kernel.setBinary(`cover:${resourceUrlKey(coverUrl)}`, new Uint8Array(imageData), COVER_CACHE_TTL)
  })
  // 封面失效：删除归一化 key 的磁盘+内存缓存（配合 musicApi:invalidateCoverUrl）
  registerIpcHandlerSimple('cache:invalidateCover', async (coverUrl: string) => {
    await kernel.remove(`cover:${resourceUrlKey(coverUrl)}`)
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
