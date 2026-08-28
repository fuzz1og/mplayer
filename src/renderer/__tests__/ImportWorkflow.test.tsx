import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ImportPlaylistModal from '../components/ImportPlaylistModal';

// Mock importService - keep real parsePlaylistUrl, mock async import
vi.mock('@/renderer/services/importService', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    importFromLink: vi.fn(),
  };
});

// music 域 IPC 走 callMusicApi（getNeteasePlaylistSongs 原生歌单接口）
const callMusicApiMock = vi.hoisted(() => vi.fn(async () => []));
vi.mock('@/renderer/services/callMusicApi', () => ({
  callMusicApi: callMusicApiMock,
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: {
      warning: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    },
  };
});

import { importFromLink } from '@/renderer/services/importService';

describe('ImportWorkflow Integration', () => {
  const defaultProps = {
    open: true,
    playlistId: 1,
    existingSongs: [],
    onClose: vi.fn(),
    onImported: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    callMusicApiMock.mockResolvedValue([]);
  });

  it('should complete full link import flow via native netease api', async () => {
    const mockSongs = [
      { id: '100', name: 'Song 1', artist: 'Artist 1', sourceType: 'netease' },
    ];

    const mockResult = {
      successes: [
        {
          line: 'Song 1 - Artist 1',
          song: mockSongs[0],
          source: 'netease',
        },
      ],
      failures: [],
      skips: [],
    };

    callMusicApiMock.mockResolvedValue(mockSongs);
    (importFromLink as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    render(<ImportPlaylistModal {...defaultProps} />);

    // Input URL
    const input = screen.getByPlaceholderText('请输入歌单链接（支持网易云和QQ音乐）');
    fireEvent.change(input, {
      target: { value: 'https://music.163.com/#/playlist?id=123' },
    });

    // Click parse
    fireEvent.click(screen.getByText('解析链接'));

    // Wait for songs to appear in preview table
    await waitFor(() => {
      expect(screen.getByText(/共 1 首歌曲/)).toBeInTheDocument();
    });

    // 原生接口拉全量曲目
    expect(callMusicApiMock).toHaveBeenCalledWith('getNeteasePlaylistSongs', 123);

    // Click import selected songs
    fireEvent.click(screen.getByText(/导入选中歌曲/));

    // Wait for import to complete
    await waitFor(() => {
      expect(screen.getByText('导入完成')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Verify import was called correctly
    expect(importFromLink).toHaveBeenCalledWith(
      1,
      mockSongs,
      new Set(['100']),
      [],
      expect.any(Function)
    );
  });

  it('should handle link parse failure', async () => {
    callMusicApiMock.mockRejectedValue(new Error('Network error'));

    render(<ImportPlaylistModal {...defaultProps} />);

    // Input URL
    const input = screen.getByPlaceholderText('请输入歌单链接（支持网易云和QQ音乐）');
    fireEvent.change(input, {
      target: { value: 'https://music.163.com/#/playlist?id=123' },
    });

    // Click parse
    fireEvent.click(screen.getByText('解析链接'));

    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText('解析链接失败，请检查网络连接')).toBeInTheDocument();
    });
  });
});
