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

// music 域 IPC 走 callMusicApi（getPlaylistSongs 原生歌单接口 / resolvePlaylistLink）
const callMusicApiMock = vi.hoisted(() => vi.fn(async () => []));
vi.mock('@/renderer/services/callMusicApi', () => ({
  callMusicApi: callMusicApiMock,
}));

vi.mock('@/renderer/components/LinkImportForm', () => ({
  default: ({ linkUrl, onLinkUrlChange, onParse, loading, error }: any) => (
    <div data-testid="link-import-form">
      <div>通过网易云歌单链接导入歌曲</div>
      <input value={linkUrl} onChange={(e) => onLinkUrlChange(e.target.value)} />
      <button onClick={onParse} disabled={loading}>解析链接</button>
      {error && <div>{error}</div>}
    </div>
  ),
}));

vi.mock('@/renderer/components/LinkPreviewTable', () => ({
  default: ({ songs, onConfirm, onCancel }: any) => (
    <div data-testid="link-preview-table">
      <div>共 {songs.length} 首歌曲</div>
      <button onClick={() => onConfirm(new Set(songs.map((s: any) => s.id)))}>确认导入</button>
      <button onClick={onCancel}>取消</button>
    </div>
  ),
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

const mockSongs = [
  { id: '100', name: 'Song 1', artist: 'Artist 1', sourceType: 'netease' },
  { id: '101', name: 'Song 2', artist: 'Artist 2', sourceType: 'netease' },
];

describe('ImportPlaylistModal', () => {
  const defaultProps = {
    open: true,
    playlistId: 1,
    existingSongs: [],
    onClose: vi.fn(),
    onImported: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    callMusicApiMock.mockResolvedValue({ songs: [], total: 0 });
  });

  it('应该只显示链接导入（无文本导入 tab）', () => {
    render(<ImportPlaylistModal {...defaultProps} />);

    expect(screen.getByTestId('link-import-form')).toBeInTheDocument();
    expect(screen.queryByText('文本导入')).not.toBeInTheDocument();
  });

  it('网易歌单直链应走原生 getPlaylistSongs', async () => {
    callMusicApiMock.mockResolvedValue({ songs: mockSongs, total: mockSongs.length });

    render(<ImportPlaylistModal {...defaultProps} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://music.163.com/#/playlist?id=123456' },
    });
    fireEvent.click(screen.getByText('解析链接'));

    await waitFor(() => {
      expect(screen.getByText(/共 2 首歌曲/)).toBeInTheDocument();
    });

    expect(callMusicApiMock).toHaveBeenCalledWith('getPlaylistSongs', 'netease', 123456, 0, 0);
  });

  it('网易短链应先经主进程解析重定向，再走原生接口', async () => {
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'resolvePlaylistLink') {
        return 'https://music.163.com/playlist?id=42';
      }
      return { songs: mockSongs, total: mockSongs.length };
    });

    render(<ImportPlaylistModal {...defaultProps} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://163cn.tv/abc123' },
    });
    fireEvent.click(screen.getByText('解析链接'));

    await waitFor(() => {
      expect(screen.getByText(/共 2 首歌曲/)).toBeInTheDocument();
    });

    expect(callMusicApiMock).toHaveBeenCalledWith('resolvePlaylistLink', 'https://163cn.tv/abc123');
    expect(callMusicApiMock).toHaveBeenCalledWith('getPlaylistSongs', 'netease', 42, 0, 0);
  });

  it('解析失败应显示错误', async () => {
    callMusicApiMock.mockRejectedValue(new Error('Network error'));

    render(<ImportPlaylistModal {...defaultProps} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://music.163.com/#/playlist?id=123' },
    });
    fireEvent.click(screen.getByText('解析链接'));

    await waitFor(() => {
      expect(screen.getByText('解析链接失败，请检查网络连接')).toBeInTheDocument();
    });
  });

  it('无法识别的链接应提示格式错误', async () => {
    render(<ImportPlaylistModal {...defaultProps} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://example.com/foo' },
    });
    fireEvent.click(screen.getByText('解析链接'));

    await waitFor(() => {
      expect(screen.getByText('请输入有效的歌单链接（支持网易云和QQ音乐）')).toBeInTheDocument();
    });
    expect(callMusicApiMock).not.toHaveBeenCalled();
  });

  it('确认后应调用 importFromLink 入库', async () => {
    callMusicApiMock.mockResolvedValue({ songs: mockSongs, total: mockSongs.length });
    (importFromLink as ReturnType<typeof vi.fn>).mockResolvedValue({
      successes: [{ line: 'Song 1 - Artist 1', song: mockSongs[0], source: 'netease' }],
      failures: [],
      skips: [],
    });

    render(<ImportPlaylistModal {...defaultProps} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://music.163.com/#/playlist?id=123456' },
    });
    fireEvent.click(screen.getByText('解析链接'));

    await waitFor(() => {
      expect(screen.getByText(/共 2 首歌曲/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('确认导入'));

    await waitFor(() => {
      expect(importFromLink).toHaveBeenCalledWith(
        1,
        mockSongs,
        new Set(['100', '101']),
        [],
        expect.any(Function)
      );
    });
  });
});
