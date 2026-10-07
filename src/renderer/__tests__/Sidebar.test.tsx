import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../components/Sidebar';

describe('Sidebar', () => {
  const defaultProps = {
    currentPage: 'discover',
    onPageChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该渲染侧边栏', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('发现音乐')).toBeInTheDocument();
    expect(screen.getByText('我的收藏')).toBeInTheDocument();
    expect(screen.getByText('播放历史')).toBeInTheDocument();
    expect(screen.getByText('我的歌单')).toBeInTheDocument();
  });

  it('应该高亮当前页面', () => {
    render(<Sidebar {...defaultProps} currentPage="discover" />);
    const discoverItem = screen.getByText('发现音乐').closest('button');
    expect(discoverItem).toHaveAttribute('aria-current', 'page');
  });

  it('应该点击导航到对应页面', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('我的收藏'));
    expect(defaultProps.onPageChange).toHaveBeenCalledWith('favorites');
  });
  it('应该显示所有导航项', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('发现音乐')).toBeInTheDocument();
    expect(screen.getByText('本地音乐')).toBeInTheDocument();
    expect(screen.getByText('下载管理')).toBeInTheDocument();
    expect(screen.getByText('我的收藏')).toBeInTheDocument();
    expect(screen.getByText('播放历史')).toBeInTheDocument();
    expect(screen.getByText('我的歌单')).toBeInTheDocument();
    expect(screen.getByText('播放队列')).toBeInTheDocument();
  });

  it('应该显示当前页面高亮', () => {
    render(<Sidebar {...defaultProps} currentPage="favorites" />);
    const favoritesItem = screen.getByText('我的收藏').closest('button');
    expect(favoritesItem).toHaveAttribute('aria-current', 'page');
  });

  it('应该点击其他页面', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('本地音乐'));
    expect(defaultProps.onPageChange).toHaveBeenCalledWith('local');
  });

  it('应该显示设置入口', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  // #579：徽标挂在左下「设置」项旁
  describe('更新徽标（#579）', () => {
    it('updateAvailable 为 true 时设置项出现徽标且带可访问名', () => {
      render(<Sidebar {...defaultProps} updateAvailable />);
      expect(screen.getByTestId('update-badge')).toBeInTheDocument();
      expect(screen.getByLabelText('设置（有可用更新）')).toBeInTheDocument();
    });

    it('updateAvailable 为 false（默认）时不渲染徽标', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.queryByTestId('update-badge')).not.toBeInTheDocument();
      // 无徽标时不加 aria-label，可访问名退回按钮文本
      expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    });
  });
});
