import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sidebar from '../components/Sidebar';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { IpcClient } from '@/renderer/services/IpcClient';

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
 * 1.9.0 信息架构（#694）：侧栏分两段——「发现」（推荐/发现）与「资料库」（我喜欢的音乐/最近播放/我的歌单/本地）。
 * 「资料库」只是分组标题，不再是可点击页面；设置仍在标题栏。
 */
describe('Sidebar', () => {
  const defaultProps = {
    currentPage: 'discover',
    onPageChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useFavoriteStore.setState({ favorites: [], favoriteIds: [] });
    vi.spyOn(IpcClient, 'invoke').mockResolvedValue([] as never);
  });

  it('两段分组标题：发现 / 资料库，资料库不是可点条目', async () => {
    render(<Sidebar {...defaultProps} />);
    const labels = Array.from(document.querySelectorAll('.sidebar__group-label')).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['发现', '资料库']);
    expect(screen.queryByRole('button', { name: '资料库' })).not.toBeInTheDocument();
    // 「歌单」组连同其下的「我的歌单」并入资料库段
    expect(screen.queryByText('歌单')).not.toBeInTheDocument();
    await waitFor(() => expect(IpcClient.invoke).toHaveBeenCalledWith('playlist:getAll'));
  });

  it('六个入口：发现段 2 个 + 资料库段 4 个，顺序固定', () => {
    render(<Sidebar {...defaultProps} />);
    const labels = Array.from(document.querySelectorAll('.sidebar__label')).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['推荐', '发现', '我喜欢的音乐', '最近播放', '我的歌单', '本地']);
    // 第一段只有推荐/发现：资料库四项都在资料库标题之后
    const items = Array.from(document.querySelectorAll('.sidebar__group-label, .sidebar__item'));
    const libraryStart = items.findIndex((el) => el.classList.contains('sidebar__group-label') && el.textContent === '资料库');
    const namesAfterLibrary = items.slice(libraryStart + 1).map((el) => el.textContent?.replace(/\d+$/, '').trim());
    expect(namesAfterLibrary).toEqual(['我喜欢的音乐', '最近播放', '我的歌单', '本地']);
  });

  it('点击资料库各项导航到对应路由 key', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('我喜欢的音乐'));
    expect(defaultProps.onPageChange).toHaveBeenLastCalledWith('favorites');
    fireEvent.click(screen.getByText('最近播放'));
    expect(defaultProps.onPageChange).toHaveBeenLastCalledWith('history');
    fireEvent.click(screen.getByText('我的歌单'));
    expect(defaultProps.onPageChange).toHaveBeenLastCalledWith('playlists');
    fireEvent.click(screen.getByText('本地'));
    expect(defaultProps.onPageChange).toHaveBeenLastCalledWith('local');
    fireEvent.click(screen.getByText('推荐'));
    expect(defaultProps.onPageChange).toHaveBeenLastCalledWith('recommend');
  });

  it('不再有品牌块（无 logo / 无 MPlayer 字样）', () => {
    const { container } = render(<Sidebar {...defaultProps} />);
    expect(container.querySelector('.sidebar__brand')).toBeNull();
    expect(container.querySelector('.sidebar__brand-icon')).toBeNull();
    expect(screen.queryByText('MPlayer')).toBeNull();
  });

  it('材质契约：侧栏用 --surface-sidebar 有意实色，不依赖 blur，且没有右边框', () => {
    const block = cssBlock('.sidebar');
    expect(block).toContain('var(--surface-sidebar)');
    expect(block).not.toContain('backdrop-filter');
    expect(block).not.toContain('border-right');
  });

  it('分组标题复用同一套样式：12px / 600 / tertiary、上间距 16px', () => {
    const block = cssBlock('.sidebar__group-label');
    expect(block).toContain('var(--sidebar-group-size)');
    expect(block).toContain('var(--weight-semibold)');
    expect(block).toContain('var(--text-tertiary)');
    expect(block).toContain('padding: var(--space-4) 10px 6px;');
  });

  it('导航从侧栏顶部开始（不再为品牌块留 44px 高度）', () => {
    const block = cssBlock('.sidebar__nav');
    expect(block).toContain('padding: var(--space-3)');
  });

  it('高亮当前页面', () => {
    render(<Sidebar {...defaultProps} currentPage="local" />);
    expect(screen.getByText('本地').closest('button')).toHaveAttribute('aria-current', 'page');
  });

  it('计数徽标现算：收藏数与歌单数各一项', async () => {
    useFavoriteStore.setState({
      favorites: [{ id: 's1' }, { id: 's2' }] as never,
      favoriteIds: ['s1', 's2'],
    });
    vi.spyOn(IpcClient, 'invoke').mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }] as never);
    const { container } = render(<Sidebar {...defaultProps} />);
    await waitFor(() => expect(container.querySelectorAll('.sidebar__count').length).toBe(2));
    const counts = Array.from(container.querySelectorAll('.sidebar__count')).map((el) => el.textContent);
    expect(counts).toEqual(['2', '3']);
  });
});
