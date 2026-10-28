import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sidebar from '../components/Sidebar';

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const sidebarCss = readFileSync(join(testDir, '..', 'styles', 'sidebar.css'), 'utf8');

/** 取「整行只有该选择器 + {」的规则体；组选择器（行尾带逗号）不参与匹配。 */
function cssBlock(selector: string): string {
  const lines = sidebarCss.split('\n');
  const start = lines.findIndex((line) => line.trim() === selector + ' {');
  if (start === -1) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i].trim() !== '}'; i += 1) body.push(lines[i]);
  return body.join('\n');
}

/**
 * 1.9.0 导航：本地音乐/下载管理收进「资料库」入口，收藏与历史保留快捷入口；
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
    expect(labels).toEqual(['推荐', '发现', '资料库', '我喜欢的音乐', '最近播放', '我的歌单']);
    expect(screen.queryByText('设置')).not.toBeInTheDocument();
  });

  it('不再有品牌块（无 logo / 无 MPlayer 字样）', () => {
    const { container } = render(<Sidebar {...defaultProps} />);
    expect(container.querySelector('.sidebar__brand')).toBeNull();
    expect(container.querySelector('.sidebar__brand-icon')).toBeNull();
    expect(screen.queryByText('MPlayer')).toBeNull();
  });

  it('材质契约：侧栏用 --material-chrome + --material-blur，且没有右边框', () => {
    const block = cssBlock('.sidebar');
    expect(block).toContain('var(--material-chrome)');
    expect(block).toContain('var(--material-blur)');
    expect(block).not.toContain('border-right');
    expect(block).not.toContain('var(--surface-sidebar)');
  });

  it('材质关闭时侧栏回退实色（data-material=off）', () => {
    expect(cssBlock("html[data-material='off'] .sidebar")).toContain('var(--surface-sidebar)');
  });

  it('导航从侧栏顶部开始（不再为品牌块留 44px 高度）', () => {
    const block = cssBlock('.sidebar__nav');
    expect(block).toContain('padding: var(--space-3)');
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

  it('「资料库」是合并后的单一入口', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: '资料库' }));
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
