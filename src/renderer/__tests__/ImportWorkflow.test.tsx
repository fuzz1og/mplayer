import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ImportPlaylistModal from '../components/ImportPlaylistModal';

// Mock importService - keep real parseSongList and parsePlaylistUrl, mock async functions
vi.mock('@/renderer/services/importService', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    importSongs: vi.fn(),
    importFromLink: vi.fn(),
  };
});

// Mock musicApi for dynamic import in modal
vi.mock('@/main/api/musicApi', () => ({
  musicApi: {
    getPlaylistSongsFromThirdParty: vi.fn(),
  },
}));

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => ({})),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
  verticalListSortingStrategy: vi.fn(),
  arrayMove: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
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

import { importSongs, importFromLink } from '@/renderer/services/importService';
import { musicApi } from '@/main/api/musicApi';

describe('ImportWorkflow Integration', () => {
  const defaultProps = {
    open: true,
    playlistId: 1,
    playlistName: 'Test Playlist',
    existingSongs: [],
    onClose: vi.fn(),
    onImported: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full text import flow', async () => {
    const mockResult = {
      successes: [
        {
          line: 'Test Song - Artist',
          song: { id: '1', name: 'Test Song', artist: 'Artist', album: '', url: '', cover: '', lrc: '', duration: 0, sourceType: 'netease' },
          source: 'netease',
        },
      ],
      failures: [],
      skips: [],
    };

    (importSongs as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    render(<ImportPlaylistModal {...defaultProps} />);

    // Input text
    const textarea = screen.getByPlaceholderText(/七里香/);
    fireEvent.change(textarea, { target: { value: 'Test Song - Artist' } });

    // Click import
    fireEvent.click(screen.getByText('开始导入'));

    // Wait for import to complete
    await waitFor(() => {
      expect(screen.getByText('导入完成')).toBeInTheDocument();
    });

    // Verify import was called correctly
    expect(importSongs).toHaveBeenCalledWith(
      1,
      'Test Song - Artist',
      ['netease', 'qq', 'kugou'],
      [],
      expect.any(Function)
    );
  });

  it('should complete full link import flow', async () => {
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

    (musicApi.getPlaylistSongsFromThirdParty as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockSongs
    );
    (importFromLink as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    render(<ImportPlaylistModal {...defaultProps} />);

    // Switch to link import tab
    fireEvent.click(screen.getByText('链接导入'));

    // Input URL
    const input = screen.getByPlaceholderText('请输入网易云歌单链接');
    fireEvent.change(input, {
      target: { value: 'https://music.163.com/#/playlist?id=123' },
    });

    // Click parse
    fireEvent.click(screen.getByText('解析链接'));

    // Wait for songs to appear in preview table
    await waitFor(() => {
      expect(screen.getByText(/共 1 首歌曲/)).toBeInTheDocument();
    });

    // Click import selected songs
    fireEvent.click(screen.getByText(/导入选中歌曲/));

    // Wait for import to complete
    await waitFor(() => {
      expect(screen.getByText('导入完成')).toBeInTheDocument();
    });

    // Verify import was called correctly
    expect(importFromLink).toHaveBeenCalledWith(
      1,
      'https://music.163.com/#/playlist?id=123',
      new Set(['100']),
      [],
      expect.any(Function)
    );
  });

  it('should handle link parse failure', async () => {
    (musicApi.getPlaylistSongsFromThirdParty as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    render(<ImportPlaylistModal {...defaultProps} />);

    // Switch to link import tab
    fireEvent.click(screen.getByText('链接导入'));

    // Input URL
    const input = screen.getByPlaceholderText('请输入网易云歌单链接');
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
