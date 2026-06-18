import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cacheService } from '../services/cacheService';

// Mock IpcClient
vi.mock('../services/IpcClient', () => ({
  IpcClient: {
    invoke: vi.fn()
  }
}));

describe('cacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('歌曲缓存', () => {
    it('应该获取歌曲缓存', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockSong = { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' };
      (IpcClient.invoke as any).mockResolvedValue(mockSong);

      const result = await cacheService.getSongCache('1');
      expect(result).toEqual(mockSong);
      expect(IpcClient.invoke).toHaveBeenCalledWith('cache:getSong', '1');
    });

    it('应该设置歌曲缓存', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      const song = { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' };
      await cacheService.setSongCache('1', song);
      expect(IpcClient.invoke).toHaveBeenCalledWith('cache:setSong', '1', song);
    });
  });

  describe('URL 缓存', () => {
    it('应该获取 URL 缓存', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockUrl = { url: 'http://example.com/song.mp3', cover: 'http://example.com/cover.jpg', lrc: '歌词' };
      (IpcClient.invoke as any).mockResolvedValue(mockUrl);

      const result = await cacheService.getUrlCache('1');
      expect(result).toEqual(mockUrl);
      expect(IpcClient.invoke).toHaveBeenCalledWith('cache:getUrl', '1');
    });

    it('应该设置 URL 缓存', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      const urlData = { url: 'http://example.com/song.mp3', cover: 'http://example.com/cover.jpg', lrc: '歌词' };
      await cacheService.setUrlCache('1', urlData);
      expect(IpcClient.invoke).toHaveBeenCalledWith('cache:setUrl', '1', urlData);
    });
  });

  describe('封面缓存', () => {
    it('应该获取封面缓存', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockCover = 'http://example.com/cover.jpg';
      (IpcClient.invoke as any).mockResolvedValue(mockCover);

      const result = await cacheService.getCoverCache('1');
      expect(result).toBe(mockCover);
      expect(IpcClient.invoke).toHaveBeenCalledWith('cache:getCover', '1');
    });

    it('应该设置封面缓存', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await cacheService.setCoverCache('1', 'http://example.com/cover.jpg');
      expect(IpcClient.invoke).toHaveBeenCalledWith('cache:setCover', '1', 'http://example.com/cover.jpg');
    });
  });

  describe('缓存管理', () => {
    it('应该清空所有缓存', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await cacheService.clearAllCache();
      expect(IpcClient.invoke).toHaveBeenCalledWith('cache:clear');
    });

    it('应该获取缓存统计信息', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockStats = { songs: 10, urls: 5, covers: 8 };
      (IpcClient.invoke as any).mockResolvedValue(mockStats);

      const result = await cacheService.getCacheStats();
      expect(result).toEqual(mockStats);
      expect(IpcClient.invoke).toHaveBeenCalledWith('cache:getStats');
    });
  });
});
