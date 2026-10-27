import { app, shell } from 'electron'
import path from 'path'
import { registerIpcHandlerSimple } from './registerHandler'
import { CacheKernel, createMemoryBackend, SongResourcesCache, type SongResources } from '@mplayer/core'
import { DiskCacheBackend } from '../cache/diskBackend'
import { isLegacyDeadUrl } from '@mplayer/core'
import { db } from '../storage/db'

let cacheKernel: CacheKernel | null = null
let diskBackend: DiskCacheBackend | null = null
let songResources: SongResourcesCache | null = null

/**
 * 磁盘缓存的容量配置（设置页 §2「存储」）：上限默认 100 MB、自动清理默认开。
 * 持久化键与默认值只在这里定义一处，读写共用同一个归一函数，避免 IPC 各写一份口径。
 */
export const CACHE_LIMIT_SETTING_KEY = 'cacheLimitMb'
export const CACHE_AUTO_CLEAN_SETTING_KEY = 'cacheAutoClean'
export const CACHE_LIMIT_DEFAULT_MB = 100
export const CACHE_LIMIT_MIN_MB = 20
export const CACHE_LIMIT_MAX_MB = 4096
/** 空间上限的步进（设置页 Stepper 一次 ±20 MB）。 */
export const CACHE_LIMIT_STEP_MB = 20
const MB = 1024 * 1024

/** 非法/越界的上限读数一律夹回区间，别让坏存档把淘汰逻辑变成「0 = 不清理」。 */
function normalizeLimitMb(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return CACHE_LIMIT_DEFAULT_MB
  return Math.min(CACHE_LIMIT_MAX_MB, Math.max(CACHE_LIMIT_MIN_MB, Math.round(n)))
}

function getDiskBackend(): DiskCacheBackend {
  if (!diskBackend) {
    const userDataPath = app.getPath('userData')
    const diskDir = path.join(userDataPath, 'cache')
    diskBackend = new DiskCacheBackend(diskDir)
  }
  return diskBackend
}

function getCacheKernel(): CacheKernel {
  if (!cacheKernel) {
    cacheKernel = new CacheKernel({
      l1: createMemoryBackend(),
      l2: getDiskBackend(),
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
 * 存档里的容量配置 → 后端。启动时调用一次（app ready 之后），之后 IPC 读写都以此为准。
 * 后端只认「字节 + 开关」，MB 换算留在本模块（渲染层不参与换算）。
 */
export async function applyCacheConfigFromStorage(): Promise<{ limitMb: number; autoClean: boolean }> {
  const [rawLimit, rawAutoClean] = await Promise.all([
    db.getSetting<number>(CACHE_LIMIT_SETTING_KEY),
    db.getSetting<boolean>(CACHE_AUTO_CLEAN_SETTING_KEY),
  ])
  const limitMb = normalizeLimitMb(rawLimit)
  const autoClean = rawAutoClean !== false
  getDiskBackend().setLimits(limitMb * MB, autoClean)
  return { limitMb, autoClean }
}

/**
 * 注册歌曲资源三件套语义缓存通道（ADR-0002）+ 容量配置三通道（1.9.0 原型 §2）。
 * 语义名即接口：getSongResources / setSongResources / clear / getStats / getConfig /
 * setLimitMb / setAutoClean。
 */
export function registerCacheIpc(): void {
  const cache = getSongResourcesCache()
  // 启动即把存档里的容量配置下传后端：淘汰只认后端上的 limitBytes，不能等用户打开设置页。
  void applyCacheConfigFromStorage().catch(() => undefined)

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
  registerIpcHandlerSimple('cache:getStats', async () => {
    // stats() 是同步契约（读的是磁盘后端增量记账的内存索引），而索引在启动时异步装载。
    // 启动后立刻打开设置页时索引可能还没好，先 await 一次，拿到的才是真实值（#410）。
    getCacheKernel()
    await diskBackend?.ensureIndexReady()
    const backend = getDiskBackend()
    const { limitBytes, autoClean } = backend.getLimits()
    // 内核的 CacheStats 只带类别计数；「构成」行要的是每类别字节，由后端快照并进来。
    return { ...cache.getStats(), bytes: backend.bytesByKind(), limitBytes, autoClean }
  })

  // 容量配置：读取即生效值 + 目录（渲染层只显示，不自己拼路径）。
  registerIpcHandlerSimple('cache:getConfig', async () => {
    const { limitMb, autoClean } = await applyCacheConfigFromStorage()
    return { limitMb, autoClean, stepMb: CACHE_LIMIT_STEP_MB, minMb: CACHE_LIMIT_MIN_MB, maxMb: CACHE_LIMIT_MAX_MB, dir: getDiskBackend().getCacheDir() }
  })

  // 改上限：落盘 → 下传后端 → 立刻按新上限回收一次（调小上限时用户期望「马上见效」）。
  registerIpcHandlerSimple('cache:setLimitMb', async (value: unknown) => {
    const limitMb = normalizeLimitMb(value)
    await db.setSetting(CACHE_LIMIT_SETTING_KEY, limitMb)
    const backend = getDiskBackend()
    const { autoClean } = backend.getLimits()
    backend.setLimits(limitMb * MB, autoClean)
    await backend.enforceLimit()
    return limitMb
  })

  registerIpcHandlerSimple('cache:setAutoClean', async (value: unknown) => {
    const autoClean = value === true
    await db.setSetting(CACHE_AUTO_CLEAN_SETTING_KEY, autoClean)
    const backend = getDiskBackend()
    const { limitBytes } = backend.getLimits()
    backend.setLimits(limitBytes, autoClean)
    if (autoClean) await backend.enforceLimit()
    return autoClean
  })

  // 「位置」行：只允许打开本应用自己的缓存目录（路径由后端给，渲染层传什么都忽略）。
  registerIpcHandlerSimple('cache:openDir', async () => {
    const dir = getDiskBackend().getCacheDir()
    const expected = path.join(app.getPath('userData'), 'cache')
    if (path.resolve(dir) !== path.resolve(expected)) return false
    return (await shell.openPath(dir)) === ''
  })
}
