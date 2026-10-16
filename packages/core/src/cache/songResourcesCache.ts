import type { CachePort, CacheStats } from './types'

/**
 * 歌曲资源语义层（ADR-0002）。
 * 调用方**不许手拼 key / TTL**——常量与 key 推导内聚在本模块（songKey），保证「这首歌的缓存 key 长
 * 什么样」只有一个事实来源。
 */

/** 歌曲资源三件套（url + cover + lrc）TTL：签名 URL 服务端时效短，12h 过期后必须重新搜索。 */
export const SONGS_TTL_MS = 12 * 60 * 60 * 1000

export interface SongResources {
  url: string
  cover: string
  lrc: string
}

export interface SongResourcesCacheOptions {
  /** 通用缓存内核（桌面 = 内存 L1 + 磁盘 L2；移动端 = 内存 L1 + 文件 L2）。 */
  kernel: CachePort
}

export class SongResourcesCache {
  private kernel: CachePort

  constructor(options: SongResourcesCacheOptions) {
    this.kernel = options.kernel
  }

  /** 歌曲资源 key（songId 已含源前缀，跨源唯一）。 */
  songKey(songId: string): string {
    return `song:${songId}`
  }

  /** 读取歌曲三件套；未命中 / 过期返回 null。 */
  async getSongResources(songId: string): Promise<SongResources | null> {
    return this.kernel.getJSON<SongResources>(this.songKey(songId))
  }

  /** 写入歌曲三件套（默认 12h；可覆盖做测试）。 */
  async setSongResources(songId: string, resources: SongResources, ttlMs?: number): Promise<void> {
    await this.kernel.setJSON(this.songKey(songId), resources, ttlMs ?? SONGS_TTL_MS)
  }

  /** 失效某首歌的资源三件套（播放失败清死链：CDN 签名过期后不得反复命中同一条坏地址）。 */
  async invalidateSongResources(songId: string): Promise<void> {
    if (!songId) return
    await this.kernel.remove(this.songKey(songId))
  }

  async clear(): Promise<void> {
    await this.kernel.clear()
  }

  getStats(): CacheStats {
    return this.kernel.stats()
  }
}
