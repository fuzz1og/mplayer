import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from '@/renderer/components/Sidebar';
import SettingsShell from '@/renderer/components/SettingsShell';
import { routes } from '@/renderer/router';

describe('应用骨架', () => {
  describe('Sidebar（#694 两段 IA）', () => {
    it('分组标题恰好两个：发现 / 资料库；资料库不是可点页面', () => {
      render(<Sidebar currentPage="recommend" onPageChange={() => undefined} />);
      const groupLabels = Array.from(document.querySelectorAll('.sidebar__group-label')).map((el) => el.textContent?.trim());
      expect(groupLabels).toEqual(['发现', '资料库']);
      expect(screen.queryByRole('button', { name: '资料库' })).toBeNull();
    });

    it('六个入口，顺序与原型一致（资料库段 4 项，本地是新页面）', () => {
      render(<Sidebar currentPage="recommend" onPageChange={() => undefined} />);
      const labels = Array.from(document.querySelectorAll('.sidebar__label')).map((el) => el.textContent?.trim());
      expect(labels).toEqual(['推荐', '发现', '我喜欢的音乐', '最近播放', '我的歌单', '本地']);
    });

    it('侧栏无品牌块（品牌已从 chrome 移除）', () => {
      const { container } = render(<Sidebar currentPage="recommend" onPageChange={() => undefined} />);
      expect(container.querySelector('.sidebar__brand')).toBeNull();
      expect(screen.queryByText('MPlayer')).toBeNull();
    });

    it('当前页用 aria-current 标记，不再有左侧强调条', () => {
      const { container } = render(<Sidebar currentPage="local" onPageChange={() => undefined} />);
      const active = container.querySelector('[aria-current="page"]');
      expect(active?.textContent).toContain('本地');
      expect(container.querySelector('.sidebar__item--bar')).toBeNull();
    });

    it('点击「本地」回传 local', async () => {
      const onPageChange = vi.fn();
      render(<Sidebar currentPage="recommend" onPageChange={onPageChange} />);
      await userEvent.click(screen.getByRole('button', { name: '本地' }));
      expect(onPageChange).toHaveBeenCalledWith('local');
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

  describe('路由（#694 信息架构）', () => {
    const LocationProbe = () => {
      const location = useLocation();
      return <span data-testid="location">{location.pathname + location.search}</span>;
    };

    const childRoute = (path: string) => {
      const child = routes[0].children?.find((route) => route.path === path);
      if (!child) throw new Error('缺少路由 ' + path);
      return child;
    };

    it('/library 保留为重定向：旧深链跳到 /favorites', async () => {
      render(
        <MemoryRouter initialEntries={['/library']}>
          <Routes>
            <Route path="/library" element={childRoute('library').element} />
            <Route path="/favorites" element={<div>我喜欢的音乐页</div>} />
          </Routes>
        </MemoryRouter>,
      );
      expect(await screen.findByText('我喜欢的音乐页')).toBeInTheDocument();
    });

    it('/download 打开本地页的下载管理（/local?downloads=1）', async () => {
      render(
        <MemoryRouter initialEntries={['/download']}>
          <Routes>
            <Route path="/download" element={childRoute('download').element} />
            <Route path="/local" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(await screen.findByTestId('location')).toHaveTextContent('/local?downloads=1');
    });

    it('/local 是本地页本体，不是重定向', () => {
      const localRoute = childRoute('local');
      expect(localRoute.element).toBeTruthy();
      // 指向本地页的路由不应再是 Navigate（旧实现重定向到 /library?tab=local）
      expect((localRoute.element as { type: { name?: string } }).type?.name).not.toBe('Navigate');
    });
  });
});

/** 规格 §2.3 回归：歌词层开着进设置时，播放栏靠 `.app-shell--settings .player-bar` 隐藏，
 * 前提是切到 /settings 收起 showLyrics，否则固定层「正在播放」会盖住设置页（App 重依赖用 doMock 降桩）。 */
describe('App 壳：全屏播放器 → 设置', () => {
  const settingsCss = readFileSync(join(dirname(fileURLToPath(String(import.meta.url))), '..', 'styles', 'settings.css'), 'utf8');

  it('歌词层开着时进设置：歌词层收起、壳带 settings 类，播放栏由 CSS 让位', async () => {
    vi.resetModules();
    const playerStub = {
      getVolume: () => 80, getPosition: () => 0, getDuration: () => 0, getState: () => 'idle',
      getCurrentSong: () => null, isPlaying: () => false, isPaused: () => false, isLoading: () => false,
      cancelLoad: vi.fn(), load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(),
      stop: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), destroy: vi.fn(),
    };
    vi.doMock('@/renderer/services/audioPlayer', () => ({ getGlobalPlayer: () => playerStub, destroyGlobalPlayer: vi.fn() }));
    vi.doMock('@/renderer/services/IpcClient', () => ({ IpcClient: { invoke: vi.fn(async () => ({ success: true })) } }));
    vi.doMock('@/renderer/services/callMusicApi', () => ({ callMusicApi: vi.fn(async () => undefined) }));
    vi.doMock('@/renderer/hooks/useGlobalShortcuts', () => ({ useGlobalShortcuts: () => {} }));
    vi.doMock('@/renderer/components/TitleBar', () => ({
      default: ({ onSettingsClick }: { onSettingsClick?: () => void }) => (
        <button type="button" onClick={onSettingsClick}>标题栏设置</button>
      ),
    }));
    vi.doMock('@/renderer/components/Sidebar', () => ({ default: () => null }));
    vi.doMock('@/renderer/components/DownloadNotifications', () => ({ default: () => null }));
    vi.doMock('@/renderer/components/UpdateReadyDialog', () => ({ default: () => null }));
    vi.doMock('@/renderer/components/PlayerBar', () => ({
      default: ({ onCoverClick }: { onCoverClick: () => void }) => (
        <div className="player-bar">
          <button type="button" onClick={onCoverClick}>播放栏封面</button>
        </div>
      ),
    }));
    vi.doMock('@/renderer/pages/LyricsPage', () => ({
      default: () => <div className="lyrics-page">歌词层</div>,
    }));

    const { MemoryRouter, Route, Routes } = await import('react-router-dom');
    const { default: App } = await import('@/renderer/App');

    render(
      <MemoryRouter initialEntries={['/discover']}>
        <Routes>
          <Route path="/" element={<App />}>
            <Route path="discover" element={<div>发现页</div>} />
            <Route path="settings" element={<div>设置页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('播放栏封面'));
    expect(screen.getByText('歌词层')).toBeInTheDocument();

    fireEvent.click(screen.getByText('标题栏设置'));
    expect(await screen.findByText('设置页')).toBeInTheDocument();
    expect(screen.queryByText('歌词层')).toBeNull();

    const shell = document.querySelector('.app-shell') as HTMLElement;
    expect(shell).toHaveClass('app-shell--settings');
    // 播放栏不卸载（播放器继续出声），可见性完全交给下面这条规则
    expect(shell.querySelector('.player-bar')).toBeTruthy();
    expect(settingsCss).toMatch(/\.app-shell--settings[\s\S]*?\.player-bar\s*\{[^}]*display:\s*none/);
  });
});
