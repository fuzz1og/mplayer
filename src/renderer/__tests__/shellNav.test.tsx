import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from '@/renderer/components/Sidebar';
import SettingsShell from '@/renderer/components/SettingsShell';
import LibraryPage from '@/renderer/pages/LibraryPage';

describe('应用骨架', () => {
  describe('Sidebar', () => {
    it('侧栏 6 个入口，顺序与原型一致（资料库组内叫「全部」，设置已上移标题栏）', () => {
      render(<Sidebar currentPage="recommend" onPageChange={() => undefined} />);
      const labels = Array.from(document.querySelectorAll('.sidebar__label')).map((el) => el.textContent?.trim());
      expect(labels).toEqual(['推荐', '发现', '全部', '我喜欢的音乐', '最近播放', '我的歌单']);
    });


    it('当前页用 aria-current 标记，不再有左侧强调条', () => {
      const { container } = render(<Sidebar currentPage="library" onPageChange={() => undefined} />);
      const active = container.querySelector('[aria-current="page"]');
      expect(active?.textContent).toContain('全部');
      expect(container.querySelector('.sidebar__item--bar')).toBeNull();
    });

    it('点击「全部」回传 library', async () => {
      const onPageChange = vi.fn();
      render(<Sidebar currentPage="recommend" onPageChange={onPageChange} />);
      await userEvent.click(screen.getByRole('button', { name: '全部' }));
      expect(onPageChange).toHaveBeenCalledWith('library');
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

    it('不再自带返回条——返回入口移到标题栏（见 titleBar.test.tsx）', () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsShell><div>设置内容</div></SettingsShell>} />
          </Routes>
        </MemoryRouter>,
      );
      expect(container.querySelector('.settings-shell__bar')).toBeNull();
    });
  });

  describe('LibraryPage', () => {
    const LocationProbe = () => {
      const location = useLocation();
      return <div data-testid="location">{location.pathname}</div>;
    };

    it('分段视图给齐五个入口，收藏/历史/本地都能一次点到', async () => {
      render(
        <MemoryRouter initialEntries={['/library']}>
          <LibraryPage />
          <LocationProbe />
        </MemoryRouter>,
      );
      // 原型（#685）：收藏与历史汇入「歌曲」列表，本地/下载/歌手/专辑各自成段
      const tabs = screen.getByRole('tablist', { name: '资料库视图' });
      expect(Array.from(tabs.querySelectorAll('[role="tab"]')).map((el) => el.textContent?.trim()))
        .toEqual(['歌曲', '专辑', '歌手', '下载', '本地']);
      await userEvent.click(screen.getByRole('tab', { name: '本地' }));
      expect(await screen.findByText(/添加文件夹|扫描/)).toBeTruthy();
    });
  });
});
