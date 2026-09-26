import { describe, expect, it } from 'vitest'
import { CacheKernel } from '../cacheKernel'
import { createMemoryBackend } from '../backends/memoryBackend'
import { CacheManager } from '../../api/memoryCacheManager'

const bytes = (s: string) => new TextEncoder().encode(s)

/**
 * #410 ①：L1 缓存「声明了容量却从不淘汰」。
 * `maxMemoryEntries` 全仓只有声明 / 默认值 / 赋值三处命中，没有任何读取；
 * 内存后端的 Map 只增不减 —— 手机端单进程长驻，每播一首歌写一条
 * `song:<身份键>`、每看一次网易内容写一批 LRC，内存只涨不落。
 */
describe('L1 内存后端：容量与 LRU（#410）', () => {
  it('淘汰的是最久未用的那条，刚读过的键留下', async () => {
    const backend = createMemoryBackend({ maxEntries: 3 })
    for (const k of ['a', 'b', 'c']) await backend.write(k, bytes(k))
    // 读 a → a 成为最近使用，b 成为最久未用
    expect(await backend.read('a')).not.toBeNull()

    await backend.write('d', bytes('d'))

    const keys = await backend.keys()
    expect(keys.length).toBe(3)
    expect(keys).not.toContain('b')
    expect(keys).toContain('a')
  })

  it('写入量与常驻条目数解耦：写 50 条、上限 5 → size 恒为 5', async () => {
    const backend = createMemoryBackend({ maxEntries: 5 })
    for (let i = 0; i < 50; i++) await backend.write(`k${i}`, bytes(String(i)))

    expect((await backend.keys()).length).toBe(5)
    expect(backend.stats?.().entries).toBe(5)
  })

  it('覆盖写把条目挪到队尾（持续更新的热键不会被当冷键淘汰）', async () => {
    const backend = createMemoryBackend({ maxEntries: 2 })
    await backend.write('hot', bytes('1'))
    await backend.write('cold', bytes('1'))
    await backend.write('hot', bytes('2')) // 覆盖写 → hot 变最近使用
    await backend.write('new', bytes('1')) // 该淘汰 cold

    const keys = await backend.keys()
    expect(keys).toContain('hot')
    expect(keys).not.toContain('cold')
  })

  it('setCapacity 收紧上限时立即淘汰到新上限', async () => {
    const backend = createMemoryBackend()
    for (let i = 0; i < 10; i++) await backend.write(`k${i}`, bytes(String(i)))

    backend.setCapacity?.(3)

    expect((await backend.keys()).length).toBe(3)
  })

  it('上限 0 / 省略 = 不限制（保持既有语义）', async () => {
    const backend = createMemoryBackend({ maxEntries: 0 })
    for (let i = 0; i < 10; i++) await backend.write(`k${i}`, bytes(String(i)))
    expect((await backend.keys()).length).toBe(10)
  })
})

describe('CacheKernel 把 maxMemoryEntries 下传到 L1（#410）', () => {
  it('内核声明的上限真正生效', async () => {
    const l1 = createMemoryBackend()
    const kernel = new CacheKernel({ l1, maxMemoryEntries: 4 })

    for (let i = 0; i < 20; i++) await kernel.setJSON(`k${i}`, { i }, 60_000)

    expect((await l1.keys()).length).toBeLessThanOrEqual(4)
  })
})

describe('memoryCacheManager 同一条容量纪律（#410）', () => {
  it('写入超过上限后 size ≤ 上限', () => {
    const manager = new CacheManager(3)
    for (let i = 0; i < 10; i++) manager.set(`k${i}`, { i }, 60_000)
    expect(manager.size).toBeLessThanOrEqual(3)
  })

  it('命中即最近使用：被读过的键不会先于冷键淘汰', () => {
    const manager = new CacheManager(2)
    manager.set('a', 1, 60_000)
    manager.set('b', 2, 60_000)

    expect(manager.get('a')).toBe(1) // a 变最近使用
    manager.set('c', 3, 60_000) // 该淘汰 b

    expect(manager.get('a')).toBe(1)
    expect(manager.get('b')).toBeNull()
    expect(manager.get('c')).toBe(3)
  })
})
