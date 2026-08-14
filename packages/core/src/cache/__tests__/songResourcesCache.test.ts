import { describe, it, expect, vi } from 'vitest'
import { SongResourcesCache, SONGS_TTL_MS, COVERS_TTL_MS } from '../songResourcesCache'
import { CacheKernel } from '../cacheKernel'
import { createMemoryBackend } from '../backends/memoryBackend'
import { resourceUrlKey } from '../../utils/resourceKey'

// 有效 PNG 头（模拟封面字节；写盘校验会走 sniffers 白名单）
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])

function makeCache() {
  const l1 = createMemoryBackend()
  const l2 = createMemoryBackend()
  const kernel = new CacheKernel({ l1, l2 })
  const cache = new SongResourcesCache({ kernel })
  return { l1, l2, kernel, cache }
}

describe('SongResourcesCache 语义层', () => {
  it('SONGS_TTL_MS 锁定 12h（签名 URL 服务端时效），COVERS_TTL_MS 锁定 6h', () => {
    expect(SONGS_TTL_MS).toBe(12 * 60 * 60 * 1000)
    expect(COVERS_TTL_MS).toBe(6 * 60 * 60 * 1000)
  })

  it('key 推导内聚：songKey = song:<id>，coverKey = cover:<归一化 URL>', () => {
    const { cache } = makeCache()
    expect(cache.songKey('netease:123')).toBe('song:netease:123')
    const cover = 'https://api.example.com/api.php?get=pic&id=1&sign=abc&t=9'
    expect(cache.coverKey(cover)).toBe(`cover:${resourceUrlKey(cover)}`)
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

  it('getCoverPath 走内核统一语义 key：归一化后同一封面命中同一路径', async () => {
    const { l2, cache } = makeCache()
    const injected = vi.fn((backendKey: string) =>
      l2.read(backendKey) === null ? null : `/cache/${backendKey}`,
    )
    const c = new SongResourcesCache({ kernel: makeCache().kernel, resolveBackendFilePath: injected })

    // 用同一 kernel 的缓存器写入封面；路径解析注入后端路径
    const coverA = 'https://api.example.com/api.php?get=pic&id=7&sign=AAA&t=1'
    const coverB = 'https://api.example.com/api.php?get=pic&id=7&sign=BBB&t=2'
    await c.setCoverBytes(coverA, PNG_BYTES)

    // 归一化 key 同一：setCoverBytes(coverA) 后 getCoverPath(coverB) 也命中（同资源）
    const path = await c.getCoverPath(coverB)
    expect(typeof path).toBe('string')
    // 注入的路径来源于语义层推导的 `:bin:cover:<归一化 URL>` 键
    expect(injected).toHaveBeenCalledWith(`:bin:cover:${resourceUrlKey(coverA)}`)
    expect(path).toBe(`/cache/:bin:cover:${resourceUrlKey(coverA)}`)
  })

  it('getCoverPath 未命中/已过期返回 null', async () => {
    const pngCache = makeCache()
    const injected = vi.fn(() => null)
    const c = new SongResourcesCache({ kernel: pngCache.kernel, resolveBackendFilePath: injected })

    expect(await c.getCoverPath('https://example.com/missing.jpg')).toBeNull()
    // 未命中不调用路径解析
    expect(injected).not.toHaveBeenCalled()
  })

  it('setCoverBytes 拒绝非图片字节（默认图/错误页绝不入缓存）', async () => {
    const { cache, kernel } = makeCache()
    const html = new TextEncoder().encode('<html>error</html>')
    await cache.setCoverBytes('https://example.com/broken.jpg', html)
    // 非图片内容不入缓存
    expect(await kernel.getBinary(`cover:${resourceUrlKey('https://example.com/broken.jpg')}`)).toBeNull()
    expect(await cache.getCoverPath('https://example.com/broken.jpg')).toBeNull()
  })

  it('invalidateCover 清除归一化 key，复用命中新路径', async () => {
    const baseCache = makeCache()
    const injected = vi.fn((backendKey: string) =>
      baseCache.l2.read(backendKey) === null ? null : `/cache/${backendKey}`,
    )
    const cache = new SongResourcesCache({
      kernel: baseCache.kernel,
      resolveBackendFilePath: injected,
    })
    const cover = 'https://api.example.com/api.php?get=pic&id=8&sign=OLD&t=1'
    await cache.setCoverBytes(cover, PNG_BYTES)
    expect(await cache.getCoverPath(cover)).not.toBeNull()

    await cache.invalidateCover(cover)
    expect(await cache.getCoverPath(cover)).toBeNull()
  })

  it('clear 清空所有条目', async () => {
    const { cache } = makeCache()
    await cache.setSongResources('a', { url: 'u', cover: 'c', lrc: 'l' })
    await cache.setCoverBytes('https://example.com/x.jpg', PNG_BYTES)
    await cache.clear()
    expect(await cache.getSongResources('a')).toBeNull()
    expect(await cache.getCoverPath('https://example.com/x.jpg')).toBeNull()
  })

  it('getStats 透传内核统计', async () => {
    const { cache, kernel } = makeCache()
    expect(cache.getStats()).toEqual(kernel.stats())
  })
})
