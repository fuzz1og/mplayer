import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../components/Sidebar';

/**
 * 1.9.0 导航：本地音乐/下载管理收进「资料库」的「全部」，收藏与历史保留快捷入口；
 * 设置不再是侧栏项——它上移标题栏（用例见 titleBar.test.tsx）。
 */
describe('Sidebar', () => {
  const defaultProps = {
    currentPage: 'discover',
    onPageChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染 6 个入口且顺序固定', () => {
    render(<Sidebar {...defaultProps} />);
    const labels = Array.from(document.querySelectorAll('.sidebar__label')).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['推荐', '发现', '全部', '我喜欢的音乐', '最近播放', '我的歌单']);
    expect(screen.queryByText('设置')).not.toBeInTheDocument();
  });

  it('品牌位从标题栏下沉到侧栏顶部', () => {
    const { container } = render(<Sidebar {...defaultProps} />);
    expect(container.querySelector('.sidebar__brand')).toBeTruthy();
    expect(container.querySelector('.sidebar__brand-icon')).toBeTruthy();
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

  it('「全部」是合并后的单一入口', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('全部'));
    expect(defaultProps.onPageChange).toHaveBeenCalledWith('library');
    // 旧入口不再各自占一行
    expect(screen.queryByText('本地音乐')).not.toBeInTheDocument();
    expect(screen.queryByText('下载管理')).not.toBeInTheDocument();
    expect(screen.queryByText('播放队列')).not.toBeInTheDocument();
  });

  it('计数由数据现算：收藏数为 0 时该项不显示计数', () => {
    const { container } = render(<Sidebar {...defaultProps} />);
    // 测试替身里 playlist:getAll 无数据 → 没有任何 .sidebar__count 被渲染出来
    expect(container.querySelectorAll('.sidebar__count').length).toBe(0);
  });
});
