import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../components/Sidebar';

/**
 * 1.9.0 导航：9 项收敛为 7 项——本地音乐/下载管理收进「资料库」，
 * 收藏与历史保留快捷入口，播放队列移到播放栏与全屏播放器。
 */
describe('Sidebar', () => {
  const defaultProps = {
    currentPage: 'discover',
    onPageChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染 7 个入口且顺序固定', () => {
    render(<Sidebar {...defaultProps} />);
    const labels = screen.getAllByRole('button').map((el) => el.textContent?.trim());
    expect(labels).toEqual(['推荐', '发现', '资料库', '我喜欢的音乐', '最近播放', '我的歌单', '设置']);
  });

  it('高亮当前页面', () => {
    render(<Sidebar {...defaultProps} currentPage="discover" />);
    expect(screen.getByText('发现').closest('button')).toHaveAttribute('aria-current', 'page');
  });

  it('点击导航到对应页面', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('我喜欢的音乐'));
    expect(defaultProps.onPageChange).toHaveBeenCalledWith('favorites');
  });

  it('资料库是合并后的单一入口', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('资料库'));
    expect(defaultProps.onPageChange).toHaveBeenCalledWith('library');
    // 旧入口不再各自占一行
    expect(screen.queryByText('本地音乐')).not.toBeInTheDocument();
    expect(screen.queryByText('下载管理')).not.toBeInTheDocument();
    expect(screen.queryByText('播放队列')).not.toBeInTheDocument();
  });

  it('显示设置入口', () => {
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
      expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    });
  });
});
