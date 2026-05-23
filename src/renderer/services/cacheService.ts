import { IpcClient } from './IpcClient';

export interface CacheStats {
  totalSize: number;
  fileCount: number;
  songsCount: number;
  coversCount: number;
  audioCount: number;
  urlsCount: number;
}

class CacheService {
  async getSongCache(keyword: string): Promise<any[] | null> {
    return IpcClient.invoke<any[]>('cache:getSong', keyword);
  }

  async setSongCache(keyword: string, songs: any[]): Promise<void> {
    await IpcClient.invoke<void>('cache:setSong', keyword, songs);
  }

  async getCoverCache(coverUrl: string): Promise<string | null> {
    return IpcClient.invoke<string | null>('cache:getCover', coverUrl);
  }

  async setCoverCache(coverUrl: string, imageData: Buffer): Promise<void> {
    await IpcClient.invoke<void>('cache:setCover', coverUrl, imageData);
  }

  async getAudioCache(audioUrl: string): Promise<string | null> {
    return IpcClient.invoke<string | null>('cache:getAudio', audioUrl);
  }

  async setAudioCache(audioUrl: string, audioData: Buffer): Promise<void> {
    await IpcClient.invoke<void>('cache:setAudio', audioUrl, audioData);
  }

  async getUrlCache(songId: string): Promise<any | null> {
    return IpcClient.invoke<any | null>('cache:getUrl', songId);
  }

  async setUrlCache(songId: string, urlData: any): Promise<void> {
    await IpcClient.invoke<void>('cache:setUrl', songId, urlData);
  }

  async clearAllCache(): Promise<void> {
    await IpcClient.invoke<void>('cache:clear');
  }

  async getCacheStats(): Promise<CacheStats> {
    return IpcClient.invoke<CacheStats>('cache:getStats');
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export const cacheService = new CacheService();
