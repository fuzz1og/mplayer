import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lyricsService } from '../services/lyricsService';

// Mock IpcClient
vi.mock('../services/IpcClient', () => ({
  IpcClient: {
    invoke: vi.fn()
  }
}));

describe('lyricsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('获取歌词', () => {
    it('应该获取歌词', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockLyrics = '[00:00.00]稻香 - 周杰伦\n[00:01.00]词：周杰伦\n[00:02.00]曲：周杰伦';
      (IpcClient.invoke as any).mockResolvedValue(mockLyrics);

      const result = await lyricsService.getLyrics('http://example.com/lyrics.lrc');
      expect(result).toBe(mockLyrics);
      expect(IpcClient.invoke).toHaveBeenCalledWith('lyrics:get', 'http://example.com/lyrics.lrc');
    });

    it('应该处理获取歌词失败', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockRejectedValue(new Error('获取失败'));

      await expect(lyricsService.getLyrics('http://example.com/lyrics.lrc')).rejects.toThrow('获取失败');
    });
  });
});
