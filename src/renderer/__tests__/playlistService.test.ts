import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playlistService } from '../services/playlistService';

// Mock IpcClient
vi.mock('../services/IpcClient', () => ({
  IpcClient: {
    invoke: vi.fn()
  }
}));

describe('playlistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('创建歌单', () => {
    it('应该创建新歌单', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(1);

      const result = await playlistService.createPlaylist('我的歌单', '测试歌单');
      expect(result).toBe(1);
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:create', '我的歌单', '测试歌单');
    });
  });

  describe('获取歌单列表', () => {
    it('应该获取所有歌单', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockPlaylists = [
        { id: 1, name: '歌单1', description: '描述1' },
        { id: 2, name: '歌单2', description: '描述2' }
      ];
      (IpcClient.invoke as any).mockResolvedValue(mockPlaylists);

      const result = await playlistService.getPlaylists();
      expect(result).toEqual(mockPlaylists);
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:getAll');
    });

    it('应该获取单个歌单', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockPlaylist = { id: 1, name: '我的歌单', description: '测试歌单' };
      (IpcClient.invoke as any).mockResolvedValue(mockPlaylist);

      const result = await playlistService.getPlaylist(1);
      expect(result).toEqual(mockPlaylist);
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:get', 1);
    });
  });

  describe('更新歌单', () => {
    it('应该更新歌单信息', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockPlaylist = { id: 1, name: '我的歌单', description: '测试歌单' };
      (IpcClient.invoke as any)
        .mockResolvedValueOnce(mockPlaylist) // getPlaylist
        .mockResolvedValueOnce(undefined); // updatePlaylist

      await playlistService.updatePlaylist(1, { name: '更新后的歌单' });
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:update', 1, { id: 1, name: '更新后的歌单', description: '测试歌单' });
    });

    it('应该处理歌单不存在的情况', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await expect(playlistService.updatePlaylist(999, { name: '更新后的歌单' })).rejects.toThrow('歌单不存在');
    });
  });

  describe('删除歌单', () => {
    it('应该删除歌单', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await playlistService.deletePlaylist(1);
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:delete', 1);
    });
  });

  describe('歌单歌曲管理', () => {
    it('应该添加歌曲到歌单', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockPlaylist = { id: 1, name: '我的歌单', description: '测试歌单' };
      (IpcClient.invoke as any)
        .mockResolvedValueOnce(mockPlaylist) // getPlaylist
        .mockResolvedValueOnce(1); // addSong

      const song = { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' };
      const result = await playlistService.addSongToPlaylist(1, song as any);
      expect(result).toBe(1);
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:addSong', 1, song);
    });

    it('应该处理歌单不存在的情况', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      const song = { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' };
      await expect(playlistService.addSongToPlaylist(999, song as any)).rejects.toThrow('歌单不存在');
    });

    it('应该从歌单移除歌曲', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await playlistService.removeSongFromPlaylist(1, '1');
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:removeSong', 1, '1');
    });

    it('应该获取歌单歌曲列表', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockSongs = [
        { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
        { id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙' }
      ];
      (IpcClient.invoke as any).mockResolvedValue(mockSongs);

      const result = await playlistService.getPlaylistSongs(1);
      expect(result).toEqual(mockSongs);
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:getSongs', 1);
    });

    it('应该批量重排歌单歌曲', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(undefined);

      await playlistService.bulkReorderPlaylistSongs(1, ['2', '1']);
      expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:reorderFull', 1, ['2', '1']);
    });
  });
});
