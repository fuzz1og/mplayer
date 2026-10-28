import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * #710：正在播放与设置的导航闭环。
 * 正在播放现在是标题栏之下的整幅内容区（不是 fixed overlay）；进设置必须移除本层与 footer、
 * 隐藏普通播放栏，返回不得复活旧层，播放状态不因导航重启。
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
  IpcClient: { invoke: vi.fn(async () => ({ success: true })) },
}));
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: vi.fn(async () => undefined) }));
vi.mock('@/renderer/hooks/useGlobalShortcuts', () => ({ useGlobalShortcuts: () => {} }));

vi.mock('@/renderer/components/TitleBar', () => ({
  default: ({ title, backLabel, onBack, onSettingsClick }: {
    title?: string; backLabel?: string; onBack?: () => void; onSettingsClick?: () => void;
  }) => (
    <div data-testid="titlebar" data-title={title} data-back-label={backLabel}>
      <button type="button" onClick={onBack}>{backLabel ?? '返回'}</button>
      <button type="button" onClick={onSettingsClick}>标题栏设置</button>
      <button type="button" aria-label="关闭">关闭</button>
    </div>
  ),
}));
vi.mock('@/renderer/components/Sidebar', () => ({ default: () => null }));
vi.mock('@/renderer/components/DownloadNotifications', () => ({ default: () => null }));
vi.mock('@/renderer/components/UpdateReadyDialog', () => ({ default: () => null }));
vi.mock('@/renderer/components/PlayerBar', () => ({
  default: ({ onCoverClick }: { onCoverClick?: () => void }) => (
    <div className="player-bar">
      <button type="button" className="player-bar__cover" onClick={onCoverClick}>播放栏封面</button>
    </div>
  ),
}));
vi.mock('@/renderer/pages/LyricsPage', () => ({
  default: ({ onBack }: { onBack?: () => void }) => (
    <div data-now-playing className="lyrics-page">
      歌词层
      <button type="button" onClick={onBack}>收起播放器</button>
    </div>
  ),
}));

import App from '@/renderer/App';
import { usePlayerStore } from '@/renderer/store/playerStore';

const CURRENT = {
  id: 'n1', name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269,
  sourceType: 'netease' as const, url: 'https://audio.example.com/n1.mp3', cover: '', lrc: '',
};

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/" element={<App />}>
          <Route path="discover" element={<div>发现页</div>} />
          <Route path="recommend" element={<div>推荐页</div>} />
          <Route path="settings" element={<div>设置页</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('正在播放 → 设置导航闭环（#710）', () => {
  beforeEach(() => {
    localStorage.clear();
    usePlayerStore.setState({ currentSong: CURRENT, isPlaying: false, currentPlaylist: [CURRENT], currentPlaylistIndex: 0 });
  });

  it('打开正在播放：标题栏给出身份与「收起播放器」，壳进入 nowplaying', () => {
    renderApp();
    fireEvent.click(screen.getByText('播放栏封面'));

    expect(document.querySelector('[data-now-playing]')).toBeTruthy();
    expect(screen.getByTestId('titlebar')).toHaveAttribute('data-title', '正在播放');
    expect(screen.getByTestId('titlebar')).toHaveAttribute('data-back-label', '收起播放器');
    expect(document.querySelector('.app-shell')).toHaveClass('app-shell--nowplaying');

    fireEvent.click(within(screen.getByTestId('titlebar')).getByRole('button', { name: '收起播放器' }));
    expect(document.querySelector('[data-now-playing]')).toBeNull();
    expect(screen.getByText('发现页')).toBeTruthy();
  });

  it('点标题栏设置：正在播放层消失、进入设置，返回不复活旧层，播放不被重启', async () => {
    const playSpy = vi.fn();
    const originalPlay = usePlayerStore.getState().play;
    usePlayerStore.setState({ play: playSpy });
    try {
      renderApp();
      fireEvent.click(screen.getByText('播放栏封面'));
      expect(document.querySelector('[data-now-playing]')).toBeTruthy();

      fireEvent.click(screen.getByText('标题栏设置'));
      expect(await screen.findByText('设置页')).toBeTruthy();
      expect(document.querySelector('[data-now-playing]')).toBeNull();
      expect(document.querySelector('.app-shell')).toHaveClass('app-shell--settings');
      expect(screen.getByTestId('titlebar')).toHaveAttribute('data-title', '设置');

      // 设置返回上一页：不得复活歌词层，也不应触发 play
      fireEvent.click(within(screen.getByTestId('titlebar')).getByRole('button', { name: '返回' }));
      expect(await screen.findByText('推荐页')).toBeTruthy();
      expect(document.querySelector('[data-now-playing]')).toBeNull();
      expect(playSpy).not.toHaveBeenCalled();
      expect(usePlayerStore.getState().currentSong?.id).toBe('n1');
    } finally {
      usePlayerStore.setState({ play: originalPlay });
    }
  });

  it('展开动画中进设置：跳过 ViewTransition 并立即移除正在播放层', async () => {
    const skipTransition = vi.fn();
    const original = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (cb: () => void) => {
        cb();
        return { skipTransition, finished: new Promise<void>(() => {}) };
      },
    });
    try {
      renderApp();
      fireEvent.click(screen.getByText('播放栏封面'));
      expect(document.querySelector('[data-now-playing]')).toBeTruthy();
      expect(skipTransition).not.toHaveBeenCalled();

      // 动画还没结束就点设置
      fireEvent.click(screen.getByText('标题栏设置'));
      expect(skipTransition).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('设置页')).toBeTruthy();
      expect(document.querySelector('[data-now-playing]')).toBeNull();
    } finally {
      if (original) Object.defineProperty(document, 'startViewTransition', original);
      else delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    }
  });
});
