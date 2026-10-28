import type { ComponentProps } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import TitleBar from '../components/TitleBar';

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const titlebarCss = readFileSync(join(testDir, '..', 'styles', 'titlebar.css'), 'utf8');

/** 取「整行只有该选择器 + {」的规则体；组选择器（行尾带逗号）不参与匹配。 */
function cssBlock(selector: string): string {
  const lines = titlebarCss.split('\n');
  const start = lines.findIndex((line) => line.trim() === selector + ' {');
  if (start === -1) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i].trim() !== '}'; i += 1) body.push(lines[i]);
  return body.join('\n');
}

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

function renderTitleBar(
  props: ComponentProps<typeof TitleBar> = {},
  options: { initialEntries?: string[]; initialIndex?: number } = {},
) {
  return render(
    <MemoryRouter initialEntries={options.initialEntries ?? ['/discover']} initialIndex={options.initialIndex}>
      <TitleBar {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** 1.9.0 收口：左列 ‹ › 设置 帮助（无 logo），中部搜索/设置标题，右侧只有窗口三键。 */
describe('TitleBar', () => {
  beforeEach(() => {
    // window:isMaximized 返回布尔值，避免最大化按钮标签被对象真值带偏
    (window as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } }).electronAPI.invoke
      .mockResolvedValue(false);
  });

  it('默认渲染搜索框、左列导航与窗口控件，且没有品牌 logo', () => {
    const { container } = renderTitleBar();
    expect(screen.getByPlaceholderText('搜索歌曲、专辑、歌手')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前进' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '帮助' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(container.querySelector('.titlebar__brand')).toBeNull();
    expect(screen.queryByText('MPlayer')).toBeNull();
  });

  it('右侧只保留窗口三键（设置已移到左列）', () => {
    const { container } = renderTitleBar();
    const trailing = container.querySelector('.titlebar__trailing') as HTMLElement;
    const buttons = within(trailing).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['最小化', '最大化', '关闭']);
  });

  it('不再显示 Ctrl K 提示，也不绑定快捷键（规格 §2.3）', () => {
    const { container } = renderTitleBar();
    expect(container.querySelector('.titlebar__kbd')).toBeNull();
    expect(screen.queryByText('Ctrl K')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('搜索歌曲、专辑、歌手')).not.toHaveFocus();
  });

  it('搜索框方角 + 几何契约：420×34、6px 圆角，来源触发器无胶囊底色', () => {
    expect(cssBlock('.titlebar__search')).toContain('width: 420px');
    expect(cssBlock('.titlebar__search')).toContain('height: 34px');
    expect(cssBlock('.titlebar__search')).toContain('border-radius: var(--radius-sm)');
    expect(cssBlock('.titlebar__search')).not.toContain('var(--radius-full)');
    expect(cssBlock('.titlebar__source-trigger')).toContain('background: transparent');
    expect(cssBlock('.titlebar')).toContain('z-index: 50');
    expect(titlebarCss).not.toContain('.titlebar__kbd');
  });

  it('回车提交关键词', () => {
    const onSearch = vi.fn();
    renderTitleBar({ onSearch });
    const input = screen.getByPlaceholderText('搜索歌曲、专辑、歌手');
    fireEvent.change(input, { target: { value: '周杰伦' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSearch).toHaveBeenCalledWith('周杰伦');
  });

  it('传 title 时中部换成标题、搜索隐藏，左列导航仍在', () => {
    const onBack = vi.fn();
    renderTitleBar({ title: '设置', onBack });
    expect(screen.queryByPlaceholderText('搜索歌曲、专辑、歌手')).toBeNull();
    expect(document.querySelector('.titlebar__title')?.textContent).toBe('设置');
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('backLabel 覆盖返回按钮可访问名：正在播放态是「收起播放器」', () => {
    const onBack = vi.fn();
    renderTitleBar({ title: '正在播放', backLabel: '收起播放器', onBack });
    expect(document.querySelector('.titlebar__title')?.textContent).toBe('正在播放');
    fireEvent.click(screen.getByRole('button', { name: '收起播放器' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('返回 / 前进走 navigate(-1) / navigate(1)', () => {
    const { unmount } = renderTitleBar({}, { initialEntries: ['/recommend', '/discover'], initialIndex: 1 });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/recommend');
    unmount();

    renderTitleBar({}, { initialEntries: ['/recommend', '/discover'], initialIndex: 0 });
    fireEvent.click(screen.getByRole('button', { name: '前进' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/discover');
  });

  it('设置进入 /settings', () => {
    renderTitleBar();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });

  it('帮助菜单含「检查更新」「关于」，分别进入设置对应分区', () => {
    const { unmount } = renderTitleBar();
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    expect(screen.getByRole('menu', { name: '帮助' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '检查更新' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/update');
    expect(screen.queryByRole('menu', { name: '帮助' })).toBeNull();
    unmount();

    renderTitleBar();
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关于' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/about');
  });

  it('更新红点挂在「帮助」上（不再单独占标题栏按钮）', () => {
    renderTitleBar({ updateAvailable: true });
    const help = screen.getByRole('button', { name: '帮助' });
    expect(within(help).getByTestId('update-badge')).toBeInTheDocument();
    expect(screen.getAllByTestId('update-badge')).toHaveLength(1);
  });

  it('帮助菜单打开后 Tab 可在菜单项之间移动', async () => {
    renderTitleBar();
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    expect(screen.getByRole('menuitem', { name: '检查更新' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('menuitem', { name: '关于' })).toHaveFocus();
  });

  it('帮助菜单 ESC 关闭并把焦点还给触发按钮', () => {
    renderTitleBar();
    const trigger = screen.getByRole('button', { name: '帮助' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: '帮助' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '帮助' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('帮助菜单点击外部关闭', () => {
    renderTitleBar();
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    expect(screen.getByRole('menu', { name: '帮助' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: '帮助' })).toBeNull();
  });

  it('帮助菜单方向键 / Home / End 在菜单项之间移动焦点', () => {
    renderTitleBar();
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    const checkUpdate = screen.getByRole('menuitem', { name: '检查更新' });
    const about = screen.getByRole('menuitem', { name: '关于' });
    expect(checkUpdate).toHaveFocus();

    fireEvent.keyDown(checkUpdate, { key: 'ArrowDown' });
    expect(about).toHaveFocus();
    fireEvent.keyDown(about, { key: 'ArrowDown' });
    expect(checkUpdate).toHaveFocus();
    fireEvent.keyDown(checkUpdate, { key: 'ArrowUp' });
    expect(about).toHaveFocus();
    fireEvent.keyDown(about, { key: 'Home' });
    expect(checkUpdate).toHaveFocus();
    fireEvent.keyDown(checkUpdate, { key: 'End' });
    expect(about).toHaveFocus();
  });

  it('搜索来源菜单：方向键打开、Home / End / 方向键移动、ESC 关闭并归还焦点', () => {
    const onSourceTypeChange = vi.fn();
    renderTitleBar({ onSourceTypeChange });
    const trigger = screen.getByRole('button', { name: '搜索来源：全部' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const menu = screen.getByRole('menu', { name: '搜索来源' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(items[0], { key: 'End' });
    expect(items[items.length - 1]).toHaveFocus();
    fireEvent.keyDown(items[items.length - 1], { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '搜索来源' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('搜索来源菜单项可实际选择并关闭菜单', () => {
    const onSourceTypeChange = vi.fn();
    renderTitleBar({ onSourceTypeChange });
    fireEvent.click(screen.getByRole('button', { name: '搜索来源：全部' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'QQ音乐' }));
    expect(onSourceTypeChange).toHaveBeenCalledWith('qq');
    expect(screen.queryByRole('menu', { name: '搜索来源' })).toBeNull();
  });

  it('搜索框无竖线分隔，结构为搜索图标 → 输入框 → 来源选择', () => {
    const { container } = renderTitleBar();
    expect(container.querySelector('.titlebar__divider')).toBeNull();
    const search = container.querySelector('.titlebar__search') as HTMLElement;
    expect(search.firstElementChild?.classList.contains('titlebar__search-icon')).toBe(true);
    expect(search.querySelector('.titlebar__search-input')).toBeTruthy();
    expect(search.lastElementChild?.classList.contains('titlebar__source')).toBe(true);
  });
});
