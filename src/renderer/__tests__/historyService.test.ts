import { describe, it, expect, vi, beforeEach } from 'vitest';
import { historyService } from '../services/historyService';

// Mock IpcClient
vi.mock('../services/IpcClient', () => ({
  IpcClient: {
    invoke: vi.fn()
  }
}));

describe('historyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('添加历史记录', () => {
    it('应该添加歌曲到历史记录', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(1);

      const song = { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' };
      const result = await historyService.addToHistory(song as any);
      expect(result).toBe(1);
      expect(IpcClient.invoke).toHaveBeenCalledWith('history:add', song);
    });
  });

  describe('获取历史记录', () => {
    it('应该获取历史记录列表', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockHistory = [
        { song: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' } },
        { song: { id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙' } }
      ];
      (IpcClient.invoke as any)
        .mockResolvedValueOnce(mockHistory) // history:get
        .mockResolvedValueOnce([{ id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座', url: '', cover: '', lrc: '' }]) // musicApi:searchSongs for song 1
        .mockResolvedValueOnce([{ id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙', url: '', cover: '', lrc: '' }]); // musicApi:searchSongs for song 2

      const result = await historyService.getHistory(10);
      expect(result).toHaveLength(2);
      expect(IpcClient.invoke).toHaveBeenCalledWith('history:get', 10);
    });

    it('应该使用默认限制数量', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue([]);

      await historyService.getHistory();
      expect(IpcClient.invoke).toHaveBeenCalledWith('history:get', 100);
    });

    it('应该处理空历史记录', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue([]);

      const result = await historyService.getHistory();
      expect(result).toHaveLength(0);
    });
  });

  describe('清空历史记录', () => {
    it('应该清空所有历史记录', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await historyService.clearHistory();
      expect(IpcClient.invoke).toHaveBeenCalledWith('history:clear');
    });
  });

  describe('移除历史记录', () => {
    it('应该移除指定歌曲的历史记录', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await historyService.removeFromHistory('1');
      expect(IpcClient.invoke).toHaveBeenCalledWith('history:remove', '1');
    });
  });
});
