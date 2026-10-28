import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import DownloadProgressModal from '@/renderer/components/DownloadProgressModal';
import type { DownloadNotification } from '@/renderer/store/downloadStore';

afterEach(() => cleanup());

const song = {
  id: 's1',
  name: '示例歌曲',
  artist: '示例歌手',
  album: '示例专辑',
  duration: 240,
  sourceType: 'netease' as const,
  url: '',
  cover: '',
  lrc: '',
};

describe('DownloadProgressModal 统一 Dialog（#709）', () => {
  it('单曲下载进度渲染在 .ui-dialog 内，不再有独立 .dl-modal 外壳', () => {
    const notification: DownloadNotification = {
      id: 'n1',
      type: 'single',
      isVisible: true,
      createdAt: Date.now(),
      tasks: [{ id: 't1', song, progress: 42, status: 'downloading' }],
    };
    render(<DownloadProgressModal notification={notification} onClose={vi.fn()} />);
    expect(document.querySelector('dialog.ui-dialog')).not.toBeNull();
    expect(document.querySelector('.dl-modal')).toBeNull();
    expect(screen.getByRole('heading', { name: '正在下载' })).toBeInTheDocument();
    expect(screen.getByText('示例歌曲')).toBeInTheDocument();
  });

  it('批量下载完成后标题与清除按钮使用 Dialog 的标题/页脚', () => {
    const notification: DownloadNotification = {
      id: 'n2',
      type: 'batch',
      isVisible: true,
      createdAt: Date.now(),
      tasks: [
        { id: 't1', song, progress: 100, status: 'completed' },
        { id: 't2', song, progress: 100, status: 'completed' },
      ],
    };
    render(<DownloadProgressModal notification={notification} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /批量下载完成/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /清除已完成/ })).toBeInTheDocument();
  });
});
