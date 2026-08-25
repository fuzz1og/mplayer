import fs from 'fs'
import { app } from 'electron'
import path from 'path'
import axios from 'axios'
import { registerIpcHandlerSimple } from './registerHandler'
import { CacheKernel, createMemoryBackend, SongResourcesCache, type SongResources } from '@mplayer/core'
import { DiskCacheBackend } from '../cache/diskBackend'
import { isLegacyDeadUrl } from '@mplayer/core'

let cacheKernel: CacheKernel | null = null
let diskBackend: DiskCacheBackend | null = null
let songResources: SongResourcesCache | null = null

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

/** 歌曲资源语义层单例（ADR-0002）：key/TTL 推导内聚，调用方不手拼。 */
function getSongResourcesCache(): SongResourcesCache {
  if (!songResources) {
    getCacheKernel()
    songResources = new SongResourcesCache({
      kernel: getCacheKernel(),
      // 封面读返回磁盘绝对路径：确认文件存在才返回（不存在视为未命中）
      resolveBackendFilePath: (backendKey) => {
        const p = getDiskBackend().getFilePath(backendKey)
        return fs.existsSync(p) ? p : null
      },
    })
  }
  return songResources
}

/**
 * 主进程侧封面落盘缓存：渲染层无会话 cookie，直接 fetch 受保护封面端点
 * 永远拿不到图（服务端返回错误页），改为在解析出 CDN 直链后由主进程
 * 下载真实图片字节写入磁盘缓存（以原始封面 URL 为键），下次渲染直接
 * 命中 file://，不再重复打上游。失败静默（不影响解析结果，渲染走 CDN）。
 * 字节写入走语义层 setCoverBytes：非图片内容由 sniffers 白名单拒绝。
 */
export async function cacheResolvedCover(originalUrl: string, cdnUrl: string): Promise<void> {
  try {
    const res = await axios.get(cdnUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      proxy: false,
    });
    const buf = Buffer.from(res.data);
    // 缓存 key 用归一化 URL（忽略 t/sign 等签名参数）：同一首歌每次搜索签名
    // 不同，但封面是同一资源——归一化后共享同一磁盘项，避免重复下载/堆积
    await getSongResourcesCache().setCoverBytes(originalUrl, new Uint8Array(buf));
  } catch {
    // 封面缓存失败不影响解析结果
  }
}

/**
 * 注册 7 个语义缓存通道（ADR-0002）。语义名即接口：
 * getSongResources / setSongResources / getCoverPath / setCoverBytes /
 * invalidateCover / clear / getStats。8 个僵尸通道（getSong/setSong/
 * getAudio/setAudio + typed getJSON/setJSON/getBinary/setBinary）已删除。
 */
export function registerCacheIpc(): void {
  const cache = getSongResourcesCache()

  registerIpcHandlerSimple('cache:getSongResources', async (songId: string) => {
    const resources = await cache.getSongResources(songId)
    // 自建 API 退役后旧 302 端点缓存视为未命中：让上层重新解析并覆盖。
    if (
      resources &&
      (isLegacyDeadUrl(resources.url) || isLegacyDeadUrl(resources.cover) || isLegacyDeadUrl(resources.lrc))
    ) {
      return null
    }
    return resources
  })
  registerIpcHandlerSimple('cache:setSongResources', async (songId: string, resources: SongResources) => {
    await cache.setSongResources(songId, resources)
  })
  registerIpcHandlerSimple('cache:getCoverPath', async (coverUrl: string) => {
    return cache.getCoverPath(coverUrl)
  })
  registerIpcHandlerSimple('cache:setCoverBytes', async (coverUrl: string, imageData: Buffer) => {
    await cache.setCoverBytes(coverUrl, new Uint8Array(imageData))
  })
  // 审查修复：渲染层封面字节下载（webSecurity 恢复后渲染层跨域 fetch 受 CORS 限制，
  // 改由主进程 axios 下载 + 语义层字节校验落盘；CDN 直链 = 原 URL，直接复用 cacheResolvedCover）
  registerIpcHandlerSimple('cache:downloadCover', async (coverUrl: string) => {
    await cacheResolvedCover(coverUrl, coverUrl)
  })
  // 封面失效：删除归一化 key 的磁盘+内存缓存（配合 musicApi:invalidateCoverUrl）
  registerIpcHandlerSimple('cache:invalidateCover', async (coverUrl: string) => {
    await cache.invalidateCover(coverUrl)
  })
  registerIpcHandlerSimple('cache:clear', async () => {
    await cache.clear()
  })
  registerIpcHandlerSimple('cache:getStats', () => {
    return cache.getStats()
  })
}
