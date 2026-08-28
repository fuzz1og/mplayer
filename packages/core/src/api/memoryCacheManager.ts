import type { Song } from '../types/index.js';

// 缓存项类型
interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiration: number; // 过期时间（毫秒）
}

// 缓存管理器类
class CacheManager {
  private cache: Map<string, CacheItem<any>> = new Map();

  // 默认过期时间配置（毫秒）
  private defaultExpirations = {
    search: 6 * 60 * 60 * 1000, // 6小时
    hotlist: 24 * 60 * 60 * 1000, // 1天
    lyrics: 24 * 60 * 60 * 1000 // 1天
  };

  /**
   * 生成缓存键
   */
  private generateKey(prefix: string, ...args: any[]): string {
    const params = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        return JSON.stringify(arg);
      }
      return String(arg);
    }).join('_');
    return `${prefix}:${params}`;
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(item: CacheItem<any>): boolean {
    return Date.now() < item.timestamp + item.expiration;
  }

  /**
   * 获取缓存数据
   */
  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    if (!this.isCacheValid(item)) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  /**
   * 设置缓存数据
   * 空数据（空数组、空字符串、null、undefined）不缓存，避免 API 失败后空数据被缓存导致不重试
   */
  set<T>(key: string, data: T, expiration: number): void {
    // 拒绝缓存空数据
    if (data === null || data === undefined) return;
    if (Array.isArray(data) && data.length === 0) return;
    if (typeof data === 'string' && data.trim() === '') return;

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiration
    });
  }

  /**
   * 清除指定前缀的缓存
   */
  clearByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清除所有缓存
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * 获取搜索结果缓存
   */
  getSearchCache(keyword: string, page: number, sourceType: string): Song[] | null {
    const key = this.generateKey('search', keyword, page, sourceType);
    return this.get<Song[]>(key);
  }

  /**
   * 设置搜索结果缓存
   */
  setSearchCache(keyword: string, page: number, sourceType: string, data: Song[]): void {
    const key = this.generateKey('search', keyword, page, sourceType);
    this.set(key, data, this.defaultExpirations.search);
  }

  /**
   * 获取热榜缓存
   */
  getHotlistCache(type: string): any[] | null {
    const key = this.generateKey('hotlist', type);
    return this.get<any[]>(key);
  }

  /**
   * 设置热榜缓存
   */
  setHotlistCache(type: string, data: any[]): void {
    const key = this.generateKey('hotlist', type);
    this.set(key, data, this.defaultExpirations.hotlist);
  }

  /**
   * 获取歌词缓存
   */
  getLyricsCache(lrcUrl: string): string | null {
    const key = this.generateKey('lyrics', lrcUrl);
    return this.get<string>(key);
  }

  /**
   * 设置歌词缓存
   */
  setLyricsCache(lrcUrl: string, data: string): void {
    const key = this.generateKey('lyrics', lrcUrl);
    this.set(key, data, this.defaultExpirations.lyrics);
  }

  /**
   * 获取歌单列表缓存
   */
  getPlaylistListCache(cat: string, order: string, offset: number, limit: number): any | null {
    const key = this.generateKey('playlistList', cat, order, offset, limit);
    return this.get<any>(key);
  }

  /**
   * 设置歌单列表缓存
   */
  setPlaylistListCache(cat: string, order: string, offset: number, limit: number, data: any): void {
    const key = this.generateKey('playlistList', cat, order, offset, limit);
    this.set(key, data, 5 * 60 * 1000); // 5 minutes TTL
  }

  /**
   * 获取歌单详情缓存
   */
  getPlaylistDetailCache(id: number): any | null {
    const key = this.generateKey('playlistDetail', id);
    return this.get<any>(key);
  }

  /**
   * 设置歌单详情缓存
   */
  setPlaylistDetailCache(id: number, data: any): void {
    const key = this.generateKey('playlistDetail', id);
    this.set(key, data, 5 * 60 * 1000); // 5 minutes TTL
  }
}

// 导出单例实例
export const cacheManager = new CacheManager();
