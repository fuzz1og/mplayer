const { ipcRenderer } = window.require('electron');

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
    try {
      return await ipcRenderer.invoke('cache:getSong', keyword);
    } catch (error) {
      console.error('获取歌曲缓存失败:', error);
      return null;
    }
  }

  async setSongCache(keyword: string, songs: any[]): Promise<void> {
    try {
      await ipcRenderer.invoke('cache:setSong', keyword, songs);
    } catch (error) {
      console.error('设置歌曲缓存失败:', error);
    }
  }

  async getCoverCache(coverUrl: string): Promise<string | null> {
    try {
      return await ipcRenderer.invoke('cache:getCover', coverUrl);
    } catch (error) {
      console.error('获取封面缓存失败:', error);
      return null;
    }
  }

  async setCoverCache(coverUrl: string, imageData: Buffer): Promise<void> {
    try {
      await ipcRenderer.invoke('cache:setCover', coverUrl, imageData);
    } catch (error) {
      console.error('设置封面缓存失败:', error);
    }
  }

  async getAudioCache(audioUrl: string): Promise<string | null> {
    try {
      return await ipcRenderer.invoke('cache:getAudio', audioUrl);
    } catch (error) {
      console.error('获取音频缓存失败:', error);
      return null;
    }
  }

  async setAudioCache(audioUrl: string, audioData: Buffer): Promise<void> {
    try {
      await ipcRenderer.invoke('cache:setAudio', audioUrl, audioData);
    } catch (error) {
      console.error('设置音频缓存失败:', error);
    }
  }

  async getUrlCache(songId: string): Promise<any | null> {
    try {
      return await ipcRenderer.invoke('cache:getUrl', songId);
    } catch (error) {
      console.error('获取URL缓存失败:', error);
      return null;
    }
  }

  async setUrlCache(songId: string, urlData: any): Promise<void> {
    try {
      await ipcRenderer.invoke('cache:setUrl', songId, urlData);
    } catch (error) {
      console.error('设置URL缓存失败:', error);
    }
  }

  async clearAllCache(): Promise<void> {
    try {
      await ipcRenderer.invoke('cache:clear');
    } catch (error) {
      console.error('清除缓存失败:', error);
    }
  }

  async getCacheStats(): Promise<CacheStats> {
    try {
      return await ipcRenderer.invoke('cache:getStats');
    } catch (error) {
      console.error('获取缓存统计失败:', error);
      return {
        totalSize: 0,
        fileCount: 0,
        songsCount: 0,
        coversCount: 0,
        audioCount: 0,
        urlsCount: 0
      };
    }
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
