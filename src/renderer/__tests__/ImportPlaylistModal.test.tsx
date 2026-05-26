import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ImportPlaylistModal from '../components/ImportPlaylistModal';

// Mock dependencies
vi.mock('@/renderer/services/importService', () => ({
  importSongs: vi.fn(),
  importFromLink: vi.fn(),
  parseSongList: vi.fn(() => []),
  parsePlaylistUrl: vi.fn(),
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
      <button onClick={() => onConfirm(new Set(songs.map((s: any) => s.id)))}>确认导入</button>
      <button onClick={onCancel}>取消</button>
    </div>
  ),
}));

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

describe('ImportPlaylistModal', () => {
  const defaultProps = {
    open: true,
    playlistId: 1,
    playlistName: 'Test Playlist',
    existingSongs: [],
    onClose: vi.fn(),
    onImported: vi.fn(),
  };

  it('应该显示标签页切换', () => {
    render(<ImportPlaylistModal {...defaultProps} />);

    expect(screen.getByText('文本导入')).toBeInTheDocument();
    expect(screen.getByText('链接导入')).toBeInTheDocument();
  });

  it('应该默认显示文本导入标签页', () => {
    render(<ImportPlaylistModal {...defaultProps} />);

    expect(screen.getByText(/粘贴歌曲列表到歌单/)).toBeInTheDocument();
  });

  it('应该切换到链接导入标签页', () => {
    render(<ImportPlaylistModal {...defaultProps} />);

    fireEvent.click(screen.getByText('链接导入'));

    expect(screen.getByText('通过网易云歌单链接导入歌曲')).toBeInTheDocument();
  });

  it('应该切换回文本导入标签页', () => {
    render(<ImportPlaylistModal {...defaultProps} />);

    fireEvent.click(screen.getByText('链接导入'));
    fireEvent.click(screen.getByText('文本导入'));

    expect(screen.getByText(/粘贴歌曲列表到歌单/)).toBeInTheDocument();
  });
});
