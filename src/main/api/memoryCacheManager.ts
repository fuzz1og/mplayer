import type { Song } from '@/shared/types/song';

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
    audioUrl: 1 * 60 * 60 * 1000, // 1小时
    lyrics: 24 * 60 * 60 * 1000, // 1天
    batchSearch: 6 * 60 * 60 * 1000 // 6小时
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
   */
  set<T>(key: string, data: T, expiration: number): void {
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
  getHotlistCache(type: 'netease' | 'qq'): any[] | null {
    const key = this.generateKey('hotlist', type);
    return this.get<any[]>(key);
  }
  
  /**
   * 设置热榜缓存
   */
  setHotlistCache(type: 'netease' | 'qq', data: any[]): void {
    const key = this.generateKey('hotlist', type);
    this.set(key, data, this.defaultExpirations.hotlist);
  }
  
  /**
   * 获取音频URL缓存
   */
  getAudioUrlCache(audioUrl: string): string | null {
    const key = this.generateKey('audioUrl', audioUrl);
    return this.get<string>(key);
  }
  
  /**
   * 设置音频URL缓存
   */
  setAudioUrlCache(audioUrl: string, data: string): void {
    const key = this.generateKey('audioUrl', audioUrl);
    this.set(key, data, this.defaultExpirations.audioUrl);
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
   * 获取批量搜索缓存
   */
  getBatchSearchCache(keywords: string[], sourceType: string): Record<string, Song[]> | null {
    const key = this.generateKey('batchSearch', keywords.sort().join(','), sourceType);
    return this.get<Record<string, Song[]>>(key);
  }
  
  /**
   * 设置批量搜索缓存
   */
  setBatchSearchCache(keywords: string[], sourceType: string, data: Record<string, Song[]>): void {
    const key = this.generateKey('batchSearch', keywords.sort().join(','), sourceType);
    this.set(key, data, this.defaultExpirations.batchSearch);
  }
}

// 导出单例实例
export const cacheManager = new CacheManager();
