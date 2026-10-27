import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '@/renderer/pages/SettingsPage';

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: {
    invoke: vi.fn((channel: string) => {
      if (channel === 'cache:getStats') {
        return Promise.resolve({
          totalSize: 52 * 1024 * 1024,
          fileCount: 120,
          songsCount: 40,
          coversCount: 50,
          audioCount: 20,
          urlsCount: 10,
        });
      }
      return Promise.resolve(undefined);
    }),
  },
}));

vi.mock('@/renderer/services/devMode', () => ({
  isDevMode: () => false,
  subscribeDevMode: () => () => undefined,
}));

vi.mock('@/renderer/theme/ThemeManager', () => ({
  useThemeMode: () => ({ mode: 'system', setMode: vi.fn() }),
}));

describe('设置页（1.9.0）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('4 组 9 页导航', () => {
    render(<SettingsPage />);
    const nav = screen.getByRole('navigation', { name: '设置导航' });
    const labels = Array.from(nav.querySelectorAll('button')).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['外观', '播放', '缓存', '下载', '直连状态', '第三方解析源', '网络', '更新', '关于']);
  });

  it('默认落在缓存页，显示占用与上限', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText('已用空间')).toBeInTheDocument();
    expect(screen.getByText(/52 MB \/ 100 MB/)).toBeInTheDocument();
  });

  it('切换页面后显示对应内容', async () => {
    render(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: /外观/ }));
    expect(await screen.findByText(/跟随系统时随操作系统的深浅色自动切换/)).toBeInTheDocument();
  });

  it('清理缓存需要二次确认', async () => {
    render(<SettingsPage />);
    await screen.findByText('清除所有缓存');
    await userEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(await screen.findByText('将释放 52 MB，此操作不可恢复；播放记录与收藏不受影响。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确定清除' })).toBeInTheDocument();
  });
});
