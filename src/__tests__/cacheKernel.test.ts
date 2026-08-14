import { describe, it, expect } from 'vitest'
import { CacheKernel } from '@mplayer/core'
import { createMemoryBackend } from '@mplayer/core'

describe('CacheKernel', () => {
  it('setJSON + getJSON round-trip', async () => {
    const kernel = new CacheKernel({ l1: createMemoryBackend() })
    await kernel.setJSON('key', { hello: 'world' }, 60000)
    const result = await kernel.getJSON<{ hello: string }>('key')
    expect(result).toEqual({ hello: 'world' })
  })

  it('setBinary + getBinary round-trip', async () => {
    const kernel = new CacheKernel({ l1: createMemoryBackend() })
    const data = new Uint8Array([1, 2, 3, 4])
    await kernel.setBinary('img', data, 60000)
    const result = await kernel.getBinary('img')
    expect(result).toEqual(data)
  })

  it('returns null for missing key', async () => {
    const kernel = new CacheKernel({ l1: createMemoryBackend() })
    expect(await kernel.getJSON('nope')).toBeNull()
    expect(await kernel.getBinary('nope')).toBeNull()
  })

  it('L2 backfill to L1 on miss', async () => {
    const l1 = createMemoryBackend()
    const l2 = createMemoryBackend()
    const kernel = new CacheKernel({ l1, l2 })

    await kernel.setJSON('key', { v: 1 }, 60000)
    await l1.clear()

    const result = await kernel.getJSON('key')
    expect(result).toEqual({ v: 1 })

    const l1Data = await l1.read(':json:key')
    expect(l1Data).not.toBeNull()
  })

  it('write-through to both L1 and L2', async () => {
    const l1 = createMemoryBackend()
    const l2 = createMemoryBackend()
    const kernel = new CacheKernel({ l1, l2 })

    await kernel.setJSON('k', { a: 1 }, 60000)

    const l1Result = await l1.read(':json:k')
    const l2Result = await l2.read(':json:k')
    expect(l1Result).not.toBeNull()
    expect(l2Result).not.toBeNull()
  })

  it('clear removes all entries', async () => {
    const kernel = new CacheKernel({ l1: createMemoryBackend() })
    await kernel.setJSON('a', 1, 60000)
    await kernel.setJSON('b', 2, 60000)
    await kernel.clear()
    expect(await kernel.getJSON('a')).toBeNull()
    expect(await kernel.getJSON('b')).toBeNull()
  })

  it('expires JSON entries after ttlMs (memory backend)', async () => {
    const kernel = new CacheKernel({ l1: createMemoryBackend() })
    // TTL 20ms：写入后立即能读，过期后必须 null
    await kernel.setJSON('key', { v: 1 }, 20)
    expect(await kernel.getJSON('key')).toEqual({ v: 1 })
    await new Promise((r) => setTimeout(r, 40))
    expect(await kernel.getJSON('key')).toBeNull()
  })

  it('expires JSON entries on L2 and does not resurrect via L1 backfill', async () => {
    const l1 = createMemoryBackend()
    const l2 = createMemoryBackend()
    const kernel = new CacheKernel({ l1, l2 })

    await kernel.setJSON('key', { v: 1 }, 20)
    await l1.clear() // 模拟重启：L1 清空，L2 保留

    // 未过期时：L2 命中并回填 L1（携带剩余 TTL）
    expect(await kernel.getJSON('key')).toEqual({ v: 1 })
    await new Promise((r) => setTimeout(r, 40))
    // L2 过期删除后，L1 也不能把条目复活
    expect(await kernel.getJSON('key')).toBeNull()
    expect(await l1.read(':json:key')).toBeNull()
  })

  it('ttlMs=0 keeps entries forever', async () => {
    const kernel = new CacheKernel({ l1: createMemoryBackend() })
    await kernel.setJSON('perm', 1, 0)
    await new Promise((r) => setTimeout(r, 30))
    expect(await kernel.getJSON('perm')).toBe(1)
  })

  it('namespace隔离', async () => {
    const backend = createMemoryBackend()
    const kernelA = new CacheKernel({ l1: backend, namespace: 'a' })
    const kernelB = new CacheKernel({ l1: backend, namespace: 'b' })

    await kernelA.setJSON('key', 'val-a', 60000)
    expect(await kernelA.getJSON('key')).toBe('val-a')
    expect(await kernelB.getJSON('key')).toBeNull()
  })
})
