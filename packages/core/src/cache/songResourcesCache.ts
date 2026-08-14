import { resourceUrlKey } from '../utils/resourceKey'
import { isImageBytes } from '../utils/sniffers'
import type { CachePort, CacheStats } from './types'

/**
 * 歌曲资源语义层（ADR-0002）。
 *
 * 在通用 CacheKernel（L1/L2 深浅两层、TTL、可插件后端）之上收编「歌曲资源」
 * 的 key/TTL 规则，桌面主进程 / 渲染端 / 移动端共享。调用方**不许手拼
 * key / TTL**——常量与 key 推导内聚在本模块（songKey / coverKey），保证
 * 「这首歌的缓存 key 长什么样」只有一个事实来源。
 *
 * 纯逻辑、零后端依赖：磁盘等平台特有实现通过注入的 `resolveBackendFilePath`
 * 接入（封面读返回可渲染 file:// 路径的语义）；CacheKernel 保持通用深内核不改接口。
 */

/** 歌曲资源三件套（url + cover + lrc）TTL：签名 URL 服务端时效短，12h 过期后必须重新搜索。 */
export const SONGS_TTL_MS = 12 * 60 * 60 * 1000
/** 封面字节 TTL。 */
export const COVERS_TTL_MS = 6 * 60 * 60 * 1000

export interface SongResources {
  url: string
  cover: string
  lrc: string
}

export interface SongResourcesCacheOptions {
  /** 通用缓存内核（桌面 = 内存 L1 + 磁盘 L2；移动端 = 内存 L1 + 文件 L2）。 */
  kernel: CachePort
  /**
   * 将某个**二进制后端 key**解析为磁盘上的绝对文件路径（存在才返回，否则 null）。
   * 桌面主进程传 `(key) => fs.existsSync(diskBackend.getFilePath(key)) ? path : null`；
   * 无此 hook 时 getCoverPath 仅返回命中与否。
   */
  resolveBackendFilePath?: (backendKey: string) => string | null
}

export class SongResourcesCache {
  private kernel: CachePort
  private resolveBackendFilePath?: (backendKey: string) => string | null

  constructor(options: SongResourcesCacheOptions) {
    this.kernel = options.kernel
    this.resolveBackendFilePath = options.resolveBackendFilePath
  }

  /** 歌曲资源 key（songId 已含源前缀，跨源唯一）。 */
  songKey(songId: string): string {
    return `song:${songId}`
  }

  /** 封面 key（归一化 URL：忽略 t/sign 等签名参数，同一资源共享一项）。 */
  coverKey(coverUrl: string): string {
    return `cover:${resourceUrlKey(coverUrl)}`
  }

  /** 读取歌曲三件套；未命中 / 过期返回 null。 */
  async getSongResources(songId: string): Promise<SongResources | null> {
    return this.kernel.getJSON<SongResources>(this.songKey(songId))
  }

  /** 写入歌曲三件套（默认 12h；可覆盖做测试）。 */
  async setSongResources(songId: string, resources: SongResources, ttlMs?: number): Promise<void> {
    await this.kernel.setJSON(this.songKey(songId), resources, ttlMs ?? SONGS_TTL_MS)
  }

  /**
   * 读取封面磁盘路径（可渲染 file:// 前缀由调用方加）。走内核统一语义 key，
   * 命中且未过期才返回平台路径；未命中 / 过期返回 null。
   */
  async getCoverPath(coverUrl: string): Promise<string | null> {
    if (!coverUrl) return null
    const key = this.coverKey(coverUrl)
    // 通过内核确认条目存在且未过期（含 L2→L1 回填语义），而非绕过内核直读磁盘。
    const bytes = await this.kernel.getBinary(key)
    if (!bytes) return null
    if (!this.resolveBackendFilePath) return null
    return this.resolveBackendFilePath(`:bin:${key}`)
  }

  /** 写入封面字节（默认 6h）。非图片内容（默认图/错误页）拒绝落盘。 */
  async setCoverBytes(coverUrl: string, bytes: Uint8Array, ttlMs?: number): Promise<void> {
    if (!coverUrl || !bytes || bytes.length === 0) return
    if (!isImageBytes(bytes)) return
    await this.kernel.setBinary(this.coverKey(coverUrl), bytes, ttlMs ?? COVERS_TTL_MS)
  }

  /** 失效某封面（配合 musicApi:invalidateCoverUrl 重搜后换新签名）。 */
  async invalidateCover(coverUrl: string): Promise<void> {
    if (!coverUrl) return
    await this.kernel.remove(this.coverKey(coverUrl))
  }

  async clear(): Promise<void> {
    await this.kernel.clear()
  }

  getStats(): CacheStats {
    return this.kernel.stats()
  }
}
