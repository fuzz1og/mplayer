import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from '@/renderer/components/Sidebar';
import SettingsShell from '@/renderer/components/SettingsShell';
import LibraryPage from '@/renderer/pages/LibraryPage';

describe('应用骨架', () => {
  describe('Sidebar', () => {
    it('恰好 7 个入口，顺序与 1.9.0 导航一致', () => {
      render(<Sidebar currentPage="recommend" onPageChange={() => undefined} />);
      const labels = screen.getAllByRole('button').map((el) => el.textContent?.trim());
      expect(labels).toEqual(['推荐', '发现', '资料库', '我喜欢的音乐', '最近播放', '我的歌单', '设置']);
    });

    it('当前页用 aria-current 标记，不再有左侧强调条', () => {
      const { container } = render(<Sidebar currentPage="library" onPageChange={() => undefined} />);
      const active = container.querySelector('[aria-current="page"]');
      expect(active?.textContent).toContain('资料库');
      expect(container.querySelector('.sidebar__item--bar')).toBeNull();
    });

    it('点击资料库回传 library', async () => {
      const onPageChange = vi.fn();
      render(<Sidebar currentPage="recommend" onPageChange={onPageChange} />);
      await userEvent.click(screen.getByRole('button', { name: '资料库' }));
      expect(onPageChange).toHaveBeenCalledWith('library');
    });

    it('有更新时设置项显示徽标', () => {
      render(<Sidebar currentPage="recommend" onPageChange={() => undefined} updateAvailable />);
      expect(screen.getByTestId('update-badge')).toBeTruthy();
    });
  });

  describe('SettingsShell', () => {
    it('按 ESC 退出设置，回到上一页', async () => {
      render(
        <MemoryRouter initialEntries={['/recommend', '/settings']} initialIndex={1}>
          <Routes>
            <Route
              path="/settings"
              element={
                <SettingsShell>
                  <div>设置内容</div>
                </SettingsShell>
              }
            />
            <Route path="/recommend" element={<div>推荐页</div>} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByText('设置内容')).toBeTruthy();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(await screen.findByText('推荐页')).toBeTruthy();
    });

    it('返回按钮同样退出', async () => {
      render(
        <MemoryRouter initialEntries={['/recommend', '/settings']} initialIndex={1}>
          <Routes>
            <Route
              path="/settings"
              element={
                <SettingsShell>
                  <div>设置内容</div>
                </SettingsShell>
              }
            />
            <Route path="/recommend" element={<div>推荐页</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await userEvent.click(screen.getByRole('button', { name: '返回' }));
      expect(await screen.findByText('推荐页')).toBeTruthy();
    });
  });

  describe('LibraryPage', () => {
    const LocationProbe = () => {
      const location = useLocation();
      return <div data-testid="location">{location.pathname}</div>;
    };

    it('四个旧入口都还在，点击后路由到原页面', async () => {
      render(
        <MemoryRouter initialEntries={['/library']}>
          <LibraryPage />
          <LocationProbe />
        </MemoryRouter>,
      );
      // 聚合视图（#685）：收藏与最近播放各成一节，本地/歌手/专辑在分组行里仍一次点到
      expect(screen.getByText('我喜欢的音乐')).toBeTruthy();
      expect(screen.getByText('最近播放')).toBeTruthy();
      expect(screen.getByText('本地音乐')).toBeTruthy();
      expect(screen.getByText('歌手')).toBeTruthy();
      expect(screen.getByText('专辑')).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: /本地音乐/ }));
      expect(screen.getByTestId('location').textContent).toBe('/local');
    });
  });
});
