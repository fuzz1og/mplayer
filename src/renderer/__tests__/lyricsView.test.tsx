import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * #403：歌词页曾是「只在 App state 里开关的视图」——它的复位点只有歌词页自己的
 * 「返回」，于是打开歌词后点侧边栏 / 顶部搜索 / 前进后退全都「URL 变了、画面没变」。
 *
 * 本票的裁决：歌词是「播放器的层」（与移动端全屏播放器同构），**不注册成路由**；
 * 修法是让视图跟随导航复位。这里用桩组件把 App 的壳渲染出来，直接验这条语义。
 */

const audioPlayerMock = vi.hoisted(() => {
  const player = {
    getVolume: vi.fn(() => 80), getPosition: vi.fn(() => 0), getDuration: vi.fn(() => 0),
    getState: vi.fn(() => 'idle'), getCurrentSong: vi.fn(() => null),
    isPlaying: vi.fn(() => false), isPaused: vi.fn(() => false), isLoading: vi.fn(() => false),
    cancelLoad: vi.fn(), load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(),
    stop: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), destroy: vi.fn(),
  };
  return { player };
});

vi.mock('@/renderer/services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));
vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn(async () => ({ success: true, data: undefined })) },
}));
vi.mock('@/renderer/services/callMusicApi', () => ({
  callMusicApi: vi.fn(async () => undefined),
}));
vi.mock('@/renderer/hooks/useGlobalShortcuts', () => ({ useGlobalShortcuts: () => {} }));

// 壳的其余部分与本语义无关：降为桩
vi.mock('@/renderer/components/TitleBar', () => ({ default: () => null }));
vi.mock('@/renderer/components/TopBar', () => ({ default: () => null }));
vi.mock('@/renderer/components/DownloadNotifications', () => ({ default: () => null }));
vi.mock('@/renderer/components/Sidebar', () => ({
  default: ({ onPageChange }: { onPageChange: (page: string) => void }) => (
    <button onClick={() => onPageChange('settings')}>侧边栏设置</button>
  ),
}));
vi.mock('@/renderer/components/PlayerBar', () => ({
  default: ({ onCoverClick }: { onCoverClick: () => void }) => (
    <button onClick={onCoverClick}>播放栏封面</button>
  ),
}));
vi.mock('@/renderer/pages/LyricsPage', () => ({
  default: ({ onBack }: { onBack?: () => void }) => (
    <div>
      <span>歌词层</span>
      <button onClick={onBack}>返回</button>
    </div>
  ),
}));

import App from '@/renderer/App';

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/" element={<App />}>
          <Route path="discover" element={<div>发现页</div>} />
          <Route path="settings" element={<div>设置页</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('歌词层跟随导航复位（#403）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('歌词打开后导航到别处：画面跟着 URL 走（缺陷本体）', async () => {
    renderApp();
    fireEvent.click(screen.getByText('播放栏封面'));
    expect(screen.getByText('歌词层')).toBeTruthy();
    expect(screen.queryByText('发现页')).toBeNull();

    fireEvent.click(screen.getByText('侧边栏设置'));

    expect(await screen.findByText('设置页')).toBeTruthy();
    expect(screen.queryByText('歌词层')).toBeNull();
  });

  it('在歌词层上再点封面 = 关灯留在当前页（不做 navigate(-1)）', () => {
    renderApp();
    fireEvent.click(screen.getByText('播放栏封面'));
    fireEvent.click(screen.getByText('播放栏封面'));

    expect(screen.queryByText('歌词层')).toBeNull();
    expect(screen.getByText('发现页')).toBeTruthy();
  });

  it('歌词层自己的「返回」仍然有效', () => {
    renderApp();
    fireEvent.click(screen.getByText('播放栏封面'));
    fireEvent.click(screen.getByText('返回'));

    expect(screen.queryByText('歌词层')).toBeNull();
    expect(screen.getByText('发现页')).toBeTruthy();
  });
});
