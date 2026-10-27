import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TitleBar from '../components/TitleBar';

/** 1.9.0 骨架：搜索上移到标题栏中部；有标题时中部换成标题、左上出现返回。 */
describe('TitleBar', () => {
  it('默认渲染搜索框与窗口控件', () => {
    render(<TitleBar />);
    expect(screen.getByPlaceholderText('搜索歌曲、专辑、歌手')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
  });

  it('Ctrl+K 聚焦搜索', () => {
    render(<TitleBar />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('搜索歌曲、专辑、歌手')).toHaveFocus();
  });

  it('回车提交关键词', () => {
    const onSearch = vi.fn();
    render(<TitleBar onSearch={onSearch} />);
    const input = screen.getByPlaceholderText('搜索歌曲、专辑、歌手');
    fireEvent.change(input, { target: { value: '周杰伦' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSearch).toHaveBeenCalledWith('周杰伦');
  });

  it('传 title 时换成标题并给出返回入口', () => {
    const onBack = vi.fn();
    render(<TitleBar title="设置" onBack={onBack} />);
    expect(screen.queryByPlaceholderText('搜索歌曲、专辑、歌手')).toBeNull();
    expect(screen.getByText('设置')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalled();
  });
});


  it('设置入口在标题栏：文字按钮可点，更新徽标跟着它（#579）', () => {
    const onSettingsClick = vi.fn();
    render(<TitleBar onSettingsClick={onSettingsClick} updateAvailable />);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(onSettingsClick).toHaveBeenCalled();
    expect(screen.getByTestId('update-badge')).toBeInTheDocument();
  });

  it('进入设置（有标题）时不再重复渲染设置按钮', () => {
    render(<TitleBar title="设置" onBack={vi.fn()} onSettingsClick={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull();
  });