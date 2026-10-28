import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

    it('侧栏无品牌块（品牌已从 chrome 移除）', () => {
      const { container } = render(<Sidebar currentPage="recommend" onPageChange={() => undefined} />);
      expect(container.querySelector('.sidebar__brand')).toBeNull();
      expect(screen.queryByText('MPlayer')).toBeNull();
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

/**
 * 规格 §2.3 回归：进入全屏播放器（歌词层）后再进设置，底部播放栏必须隐藏。
 * 播放栏靠 `.app-shell--settings .player-bar { display: none }` 让位，
 * 前提是路由切到 /settings 时 showLyrics 收起（否则固定层的「正在播放」会盖住设置页）。
 * App 的重依赖降为桩（与 lyricsView.test.tsx 同一手法），用 doMock 只影响本用例。
 */
describe('App 壳：全屏播放器 → 设置', () => {
  const shellCss = readFileSync(join(dirname(fileURLToPath(String(import.meta.url))), '..', 'styles', 'shell.css'), 'utf8');

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
    expect(shellCss).toMatch(/\.app-shell--settings[\s\S]*?\.player-bar\s*\{[^}]*display:\s*none/);
  });
});
