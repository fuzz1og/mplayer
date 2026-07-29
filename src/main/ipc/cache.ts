import { app } from 'electron'
import path from 'path'
import { registerIpcHandlerSimple } from './registerHandler'
import { CacheKernel, createMemoryBackend } from '@mplayer/core'
import { DiskCacheBackend } from '../cache/diskBackend'

let cacheKernel: CacheKernel | null = null

function getCacheKernel(): CacheKernel {
  if (!cacheKernel) {
    const userDataPath = app.getPath('userData')
    const diskDir = path.join(userDataPath, 'cache')
    cacheKernel = new CacheKernel({
      l1: createMemoryBackend(),
      l2: new DiskCacheBackend(diskDir),
    })
  }
  return cacheKernel
}

export function registerCacheIpc(): void {
  const kernel = getCacheKernel()

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
  registerIpcHandlerSimple('cache:clear', async () => {
    await kernel.clear()
  })
}