import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

// music 域 IPC 走 callMusicApi（getPlaylistSongs 原生歌单接口）
const callMusicApiMock = vi.hoisted(() => vi.fn(async () => []));
vi.mock('@/renderer/services/callMusicApi', () => ({
  callMusicApi: callMusicApiMock,
}));

import { importFromLink } from '@/renderer/services/importService';

describe('ImportWorkflow Integration', () => {
  const defaultProps = {
    open: true,
    playlistId: 1,
    existingSongs: [],
    onClose: vi.fn(),
    onImported: vi.fn(),
  };

  /** 弹层 1.9.0 起用原生 dialog 且 portal 到 body：查询限定在本次渲染的弹层内。 */
  const dialog = () => within(screen.getAllByRole('dialog').at(-1) as HTMLElement);

  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    callMusicApiMock.mockResolvedValue({ songs: [], total: 0 });
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

    callMusicApiMock.mockResolvedValue({ songs: mockSongs, total: mockSongs.length });
    (importFromLink as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    render(<ImportPlaylistModal {...defaultProps} />);

    const input = dialog().getByPlaceholderText('请输入歌单链接（支持网易云和QQ音乐）');
    fireEvent.change(input, {
      target: { value: 'https://music.163.com/#/playlist?id=123' },
    });

    fireEvent.click(dialog().getByRole('button', { name: '解析链接' }));

    await dialog().findByText(/共 1 首歌曲/);

    // 原生接口拉全量曲目
    expect(callMusicApiMock).toHaveBeenCalledWith('getPlaylistSongs', 'netease', 123, 0, 0);

    // 预览表格挂载后 useEffect 会把全部曲目设为已选，等它生效再点，否则按钮还是 disabled
    await dialog().findByText('共 1 首歌曲，已选 1 首');
    fireEvent.click(dialog().getByRole('button', { name: /导入选中歌曲/ }));

    expect(await dialog().findByText('导入完成')).toBeInTheDocument();

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
    const input = dialog().getByPlaceholderText('请输入歌单链接（支持网易云和QQ音乐）');
    fireEvent.change(input, {
      target: { value: 'https://music.163.com/#/playlist?id=123' },
    });

    fireEvent.click(dialog().getByRole('button', { name: '解析链接' }));

    // IPC 错误信息原样透出
    expect(await dialog().findByText('Network error')).toBeInTheDocument();
  });
});
