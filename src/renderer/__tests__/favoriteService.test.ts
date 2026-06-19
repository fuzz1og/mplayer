import { describe, it, expect, vi, beforeEach } from 'vitest';
import { favoriteService } from '../services/favoriteService';

// Mock IpcClient
vi.mock('../services/IpcClient', () => ({
  IpcClient: {
    invoke: vi.fn()
  }
}));

describe('favoriteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addFavorite', () => {
    it('应添加收藏', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any)
        .mockResolvedValueOnce(false)  // isFavorite 返回 false
        .mockResolvedValueOnce(1);     // addFavorite 返回 id

      const song = { id: '1', name: '稻香', artist: '周杰伦' } as any;
      const result = await favoriteService.addFavorite(song);

      expect(IpcClient.invoke).toHaveBeenCalledWith('favorite:isFavorite', '1');
      expect(IpcClient.invoke).toHaveBeenCalledWith('favorite:add', song);
      expect(result).toBe(1);
    });

    it('已收藏时应抛出错误', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(true); // isFavorite 返回 true

      const song = { id: '1', name: '稻香', artist: '周杰伦' } as any;

      await expect(favoriteService.addFavorite(song)).rejects.toThrow('歌曲已在收藏列表中');
    });
  });

  describe('removeFavorite', () => {
    it('应移除收藏', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await favoriteService.removeFavorite('1');

      expect(IpcClient.invoke).toHaveBeenCalledWith('favorite:remove', '1');
    });
  });

  describe('isFavorite', () => {
    it('应返回收藏状态', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(true);

      const result = await favoriteService.isFavorite('1');

      expect(result).toBe(true);
      expect(IpcClient.invoke).toHaveBeenCalledWith('favorite:isFavorite', '1');
    });
  });

  describe('getFavorites', () => {
    it('应返回收藏列表', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockFavorites = [
        { id: '1', name: '稻香', artist: '周杰伦' },
        { id: '2', name: '晴天', artist: '周杰伦' },
      ];
      (IpcClient.invoke as any).mockResolvedValue(mockFavorites);

      const result = await favoriteService.getFavorites();

      expect(result).toEqual(mockFavorites);
      expect(IpcClient.invoke).toHaveBeenCalledWith('favorite:getAll');
    });
  });

  describe('toggleFavorite', () => {
    it('未收藏时应添加并返回 true', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      // toggleFavorite 调用 isFavorite，然后 addFavorite 内部又调用 isFavorite
      (IpcClient.invoke as any)
        .mockResolvedValueOnce(false)  // toggleFavorite 内的 isFavorite
        .mockResolvedValueOnce(false)  // addFavorite 内的 isFavorite
        .mockResolvedValueOnce(1);     // addFavorite 内的 add

      const song = { id: '1', name: '稻香', artist: '周杰伦' } as any;
      const result = await favoriteService.toggleFavorite(song);

      expect(result).toBe(true);
    });

    it('已收藏时应移除并返回 false', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any)
        .mockResolvedValueOnce(true)   // isFavorite
        .mockResolvedValueOnce(undefined); // removeFavorite

      const song = { id: '1', name: '稻香', artist: '周杰伦' } as any;
      const result = await favoriteService.toggleFavorite(song);

      expect(result).toBe(false);
      expect(IpcClient.invoke).toHaveBeenCalledWith('favorite:remove', '1');
    });
  });
});
