import { describe, expect, it, beforeEach, vi } from 'vitest';
import { parsePlaylistUrl, importFromLink } from '../services/importService';
import { musicApi } from '@/main/api/musicApi';

// Mock musicApi
vi.mock('@/main/api/musicApi', () => ({
  musicApi: {
    getPlaylistSongsFromThirdParty: vi.fn()
  }
}));

// Mock playlistService
vi.mock('@/renderer/services/playlistService', () => ({
  playlistService: {
    addSongToPlaylist: vi.fn().mockResolvedValue(1)
  }
}));

describe('parsePlaylistUrl', () => {
  it('should recognize full NetEase playlist URL with hash', () => {
    const url = 'https://music.163.com/#/playlist?id=123456';
    const result = parsePlaylistUrl(url);
    expect(result).toEqual({ type: 'netease', id: '123456' });
  });

  it('should recognize full URL with query parameters', () => {
    const url = 'https://music.163.com/playlist?id=123456&userid=789';
    const result = parsePlaylistUrl(url);
    expect(result).toEqual({ type: 'netease', id: '123456' });
  });

  it('should recognize short link with http', () => {
    const url = 'http://163cn.tv/zoIxm3';
    const result = parsePlaylistUrl(url);
    expect(result).toEqual({ type: 'netease-short', url });
  });

  it('should recognize short link with https', () => {
    const url = 'https://163cn.tv/zoIxm3';
    const result = parsePlaylistUrl(url);
    expect(result).toEqual({ type: 'netease-short', url });
  });

  it('should return null for invalid URL', () => {
    const url = 'https://example.com';
    const result = parsePlaylistUrl(url);
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = parsePlaylistUrl('');
    expect(result).toBeNull();
  });
});

describe('importFromLink', () => {
  const mockPlaylistId = 1;
  const mockExistingSongs = [{ id: '1', name: 'Existing Song', artist: 'Artist' } as any];
  const mockOnProgress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该成功导入链接中的歌曲', async () => {
    const mockSongs = [
      { id: '100', name: 'Song 1', artist: 'Artist 1', sourceType: 'netease' },
      { id: '101', name: 'Song 2', artist: 'Artist 2', sourceType: 'netease' }
    ];

    (musicApi.getPlaylistSongsFromThirdParty as ReturnType<typeof vi.fn>).mockResolvedValue(mockSongs);

    const result = await importFromLink(
      mockPlaylistId,
      'https://music.163.com/#/playlist?id=123',
      new Set(['100', '101']),
      mockExistingSongs,
      mockOnProgress
    );

    expect(result.successes).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
    expect(musicApi.getPlaylistSongsFromThirdParty).toHaveBeenCalledWith('https://music.163.com/#/playlist?id=123');
  });

  it('应该处理空歌单', async () => {
    (musicApi.getPlaylistSongsFromThirdParty as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await importFromLink(
      mockPlaylistId,
      'https://music.163.com/#/playlist?id=123',
      new Set(),
      mockExistingSongs,
      mockOnProgress
    );

    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
  });

  it('应该处理部分歌曲导入失败', async () => {
    const mockSongs = [
      { id: '100', name: 'Song 1', artist: 'Artist 1', sourceType: 'netease' },
      { id: '101', name: 'Song 2', artist: 'Artist 2', sourceType: 'netease' }
    ];

    (musicApi.getPlaylistSongsFromThirdParty as ReturnType<typeof vi.fn>).mockResolvedValue(mockSongs);

    // 模拟只选择第一首歌
    const result = await importFromLink(
      mockPlaylistId,
      'https://music.163.com/#/playlist?id=123',
      new Set(['100']),
      mockExistingSongs,
      mockOnProgress
    );

    expect(result.successes).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
  });

  it('应该处理 API 调用失败', async () => {
    (musicApi.getPlaylistSongsFromThirdParty as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const result = await importFromLink(
      mockPlaylistId,
      'https://music.163.com/#/playlist?id=123',
      new Set(['100']),
      mockExistingSongs,
      mockOnProgress
    );

    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toContain('Network error');
  });
});
