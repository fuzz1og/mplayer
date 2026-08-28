import { describe, it, expect } from 'vitest'
import { SongResourcesCache, SONGS_TTL_MS } from '../songResourcesCache'
import { CacheKernel } from '../cacheKernel'
import { createMemoryBackend } from '../backends/memoryBackend'

function makeCache() {
  const l1 = createMemoryBackend()
  const l2 = createMemoryBackend()
  const kernel = new CacheKernel({ l1, l2 })
  const cache = new SongResourcesCache({ kernel })
  return { l1, l2, kernel, cache }
}

describe('SongResourcesCache 语义层', () => {
  it('SONGS_TTL_MS 锁定 12h（签名 URL 服务端时效）', () => {
    expect(SONGS_TTL_MS).toBe(12 * 60 * 60 * 1000)
  })

  it('key 推导内聚：songKey = song:<id>', () => {
    const cache = new SongResourcesCache({ kernel: makeCache().kernel })
    expect(cache.songKey('netease:123')).toBe('song:netease:123')
  })

  it('setSongResources + getSongResources round-trip（含音频 url，音频走内核统一键）', async () => {
    const { cache, kernel } = makeCache()
    const resources = {
      url: 'https://example.com/song.mp3', // 音频 URL（旧 getAudio/setAudio 键不一致的回退路径）
      cover: 'https://example.com/cover.jpg',
      lrc: 'https://example.com/lrc',
    }
    await cache.setSongResources('netease:1', resources)
    expect(await cache.getSongResources('netease:1')).toEqual(resources)
    // 落盘键确认：song:netease:1 三件套（音频 url 在 JSON 内含于内核键，不再有独立 audio 键）
    expect(await kernel.getJSON('song:netease:1')).toEqual(resources)
  })

  it('TTL 12h：歌曲资源到期后 getSongResources 返回 null（不复活）', async () => {
    const { cache } = makeCache()
    await cache.setSongResources('xyz', { url: 'u', cover: 'c', lrc: 'l' }, 20)
    expect(await cache.getSongResources('xyz')).toEqual({ url: 'u', cover: 'c', lrc: 'l' })
    await new Promise((r) => setTimeout(r, 40))
    expect(await cache.getSongResources('xyz')).toBeNull()
  })

  it('invalidateSongResources 清除三件套，复用不再命中死链', async () => {
    const { cache } = makeCache()
    await cache.setSongResources('netease:1', { url: 'u', cover: 'c', lrc: 'l' })
    expect(await cache.getSongResources('netease:1')).not.toBeNull()

    await cache.invalidateSongResources('netease:1')
    expect(await cache.getSongResources('netease:1')).toBeNull()
  })

  it('clear 清空所有条目', async () => {
    const { cache } = makeCache()
    await cache.setSongResources('a', { url: 'u', cover: 'c', lrc: 'l' })
    await cache.clear()
    expect(await cache.getSongResources('a')).toBeNull()
  })

  it('getStats 透传内核统计', async () => {
    const { cache, kernel } = makeCache()
    expect(cache.getStats()).toEqual(kernel.stats())
  })
})
