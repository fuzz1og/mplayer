import { app } from 'electron'
import path from 'path'
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

/** 歌曲资源语义层单例（ADR-0002）：key/TTL 推导内聚，调用方不手拼。 */
function getSongResourcesCache(): SongResourcesCache {
  if (!songResources) {
    songResources = new SongResourcesCache({ kernel: getCacheKernel() })
  }
  return songResources
}

/**
 * 注册歌曲资源三件套语义缓存通道（ADR-0002）。语义名即接口：
 * getSongResources / setSongResources / clear / getStats。
 * 封面字节/封面磁盘缓存语义已随「封面直链直渲」整链删除（issue #273）；
 * 8 个僵尸通道（getSong/setSong/getAudio/setAudio + typed getJSON/setJSON/
 * getBinary/setBinary）此前已删除。
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
  registerIpcHandlerSimple('cache:clear', async () => {
    await cache.clear()
  })
  registerIpcHandlerSimple('cache:getStats', () => {
    return cache.getStats()
  })
}
