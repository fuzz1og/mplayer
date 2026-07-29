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
    await kernel.setJSON(`url:${songId}`, urlData, 24 * 60 * 60 * 1000)
  })
  registerIpcHandlerSimple('cache:getSong', async (keyword: string) => {
    return kernel.getJSON(`search:${keyword}`)
  })
  registerIpcHandlerSimple('cache:setSong', async (keyword: string, songs: any[]) => {
    await kernel.setJSON(`search:${keyword}`, songs, 6 * 60 * 60 * 1000)
  })
  registerIpcHandlerSimple('cache:getCover', async (coverUrl: string) => {
    return kernel.getBinary(`cover:${coverUrl}`)
  })
  registerIpcHandlerSimple('cache:setCover', async (coverUrl: string, imageData: Buffer) => {
    await kernel.setBinary(`cover:${coverUrl}`, new Uint8Array(imageData), 7 * 24 * 60 * 60 * 1000)
  })
  registerIpcHandlerSimple('cache:getAudio', async (audioUrl: string) => {
    return kernel.getBinary(`audio:${audioUrl}`)
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