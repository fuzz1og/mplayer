import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import LinkPreviewTable from '../components/LinkPreviewTable';

describe('LinkPreviewTable', () => {
  const mockSongs = [
    { id: '100', name: 'Song 1', artist: 'Artist 1', sourceType: 'netease' as const },
    { id: '101', name: 'Song 2', artist: 'Artist 2', sourceType: 'netease' as const },
    { id: '102', name: 'Song 3', artist: 'Artist 3', sourceType: 'netease' as const }
  ];

  const defaultProps = {
    songs: mockSongs,
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the song list', () => {
    render(<LinkPreviewTable {...defaultProps} />);

    expect(screen.getByText('Song 1')).toBeInTheDocument();
    expect(screen.getByText('Song 2')).toBeInTheDocument();
    expect(screen.getByText('Song 3')).toBeInTheDocument();
  });

  it('should show the song count', () => {
    render(<LinkPreviewTable {...defaultProps} />);

    expect(screen.getByText('共 3 首歌曲，请选择要导入的歌曲')).toBeInTheDocument();
  });

  it('should select all songs by default', () => {
    render(<LinkPreviewTable {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach(checkbox => {
      expect(checkbox).toBeChecked();
    });
  });

  it('should call onConfirm with selected song IDs', () => {
    const onConfirm = vi.fn();
    render(<LinkPreviewTable {...defaultProps} onConfirm={onConfirm} />);

    // Deselect the second song
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    // Click confirm
    fireEvent.click(screen.getByText(/导入选中歌曲/));

    expect(onConfirm).toHaveBeenCalledWith(new Set(['100', '102']));
  });

  it('should call onCancel when cancel is clicked', () => {
    const onCancel = vi.fn();
    render(<LinkPreviewTable {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('取 消'));

    expect(onCancel).toHaveBeenCalled();
  });

  it('should display artist information', () => {
    render(<LinkPreviewTable {...defaultProps} />);

    expect(screen.getByText('Artist 1')).toBeInTheDocument();
    expect(screen.getByText('Artist 2')).toBeInTheDocument();
    expect(screen.getByText('Artist 3')).toBeInTheDocument();
  });

  it('should display source type labels', () => {
    render(<LinkPreviewTable {...defaultProps} />);

    const sourceLabels = screen.getAllByText('网易云');
    expect(sourceLabels).toHaveLength(3);
  });
});
