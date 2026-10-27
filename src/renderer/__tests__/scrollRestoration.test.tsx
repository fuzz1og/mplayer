import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Song } from '@mplayer/core';
import { useScrollRestoration } from '@/renderer/hooks/useScrollRestoration';

/**
 * #682 设置返回滚动恢复：jsdom 没有布局，scrollHeight/clientHeight 由夹具显式钉住；
 * 页面容器带 data-scroll-container 标记（线上页面由 CSS overflow 识别，同一探测逻辑）。
 */

function pinScrollMetrics(element: HTMLElement, scrollHeight = 1200, clientHeight = 600): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
}

const ScrollRegion = ({ label }: { label: string }) => {
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (node) pinScrollMetrics(node);
  }, []);
  return (
    <div ref={attach} data-testid="scroller" data-scroll-container="">
      {label}
    </div>
  );
};

/** App 壳：hook 挂在持久的壳上（真实 App 里 useScrollRestoration 就在 App，不随路由卸载）。 */
function Shell({ pathname, search = '', children }: { pathname: string; search?: string; children: ReactNode }) {
  useScrollRestoration({ pathname, search });
  return <div className="app-shell__content">{children}</div>;
}

/** 模拟懒加载页面：首帧只有骨架，120ms 后真正的滚动容器才挂载。 */
function LazyRegion({ label }: { label: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 120);
    return () => clearTimeout(timer);
  }, []);
  return ready ? <ScrollRegion label={label} /> : <div className="route-loading">加载中…</div>;
}

/** 模拟异步数据回填：容器先挂载但还没撑出滚动条，500ms 后数据到位。 */
function GrowingRegion({ label }: { label: string }) {
  const [grown, setGrown] = useState(false);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) pinScrollMetrics(node, grown ? 1200 : 0);
    },
    [grown],
  );
  useEffect(() => {
    const timer = setTimeout(() => setGrown(true), 500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div ref={attach} data-testid="scroller" data-scroll-container="">
      {label}
      {grown ? <div>数据到位</div> : null}
    </div>
  );
}

describe('设置返回后的滚动位置恢复（#682）', () => {
  it('从 /settings 返回时恢复原页面滚动位置', async () => {
    const { rerender } = render(
      <Shell pathname="/recommend">
        <ScrollRegion key="recommend" label="推荐" />
      </Shell>,
    );
    const first = screen.getByTestId('scroller');
    first.scrollTop = 480;
    fireEvent.scroll(first);

    rerender(
      <Shell pathname="/settings">
        <ScrollRegion key="settings" label="设置" />
      </Shell>,
    );
    expect(screen.getByTestId('scroller').scrollTop).toBe(0);

    rerender(
      <Shell pathname="/recommend">
        <ScrollRegion key="recommend-back" label="推荐" />
      </Shell>,
    );
    const restored = screen.getByTestId('scroller');
    await waitFor(() => expect(restored.scrollTop).toBe(480));
  });

  it('普通前进/后退不恢复（只有设置返回才恢复）', async () => {
    const { rerender } = render(
      <Shell pathname="/recommend">
        <ScrollRegion key="recommend" label="推荐" />
      </Shell>,
    );
    const first = screen.getByTestId('scroller');
    first.scrollTop = 480;
    fireEvent.scroll(first);

    rerender(
      <Shell pathname="/discover">
        <ScrollRegion key="discover" label="发现" />
      </Shell>,
    );
    rerender(
      <Shell pathname="/recommend">
        <ScrollRegion key="recommend-back" label="推荐" />
      </Shell>,
    );
    const back = screen.getByTestId('scroller');

    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(back.scrollTop).toBe(0);
  });

  it('懒加载页面：等滚动容器真正挂载后再回填', async () => {
    const { rerender } = render(
      <Shell pathname="/recommend">
        <ScrollRegion key="recommend" label="推荐" />
      </Shell>,
    );
    const first = screen.getByTestId('scroller');
    first.scrollTop = 320;
    fireEvent.scroll(first);

    rerender(
      <Shell pathname="/settings">
        <ScrollRegion key="settings" label="设置" />
      </Shell>,
    );
    rerender(
      <Shell pathname="/recommend">
        <LazyRegion key="lazy" label="推荐" />
      </Shell>,
    );

    const restored = await screen.findByTestId('scroller');
    await waitFor(() => expect(restored.scrollTop).toBe(320), { timeout: 2000 });
  });

  it('异步数据晚于固定重试档到位时，仍能回填滚动位置', async () => {
    const { rerender } = render(
      <Shell pathname="/recommend">
        <ScrollRegion key="recommend" label="推荐" />
      </Shell>,
    );
    const first = screen.getByTestId('scroller');
    first.scrollTop = 260;
    fireEvent.scroll(first);

    rerender(
      <Shell pathname="/settings">
        <ScrollRegion key="settings" label="设置" />
      </Shell>,
    );
    rerender(
      <Shell pathname="/recommend">
        <GrowingRegion key="growing" label="推荐" />
      </Shell>,
    );

    const restored = screen.getByTestId('scroller');
    await waitFor(() => expect(restored.scrollTop).toBe(260), { timeout: 2500 });
  });

  it('没有保存值时不动作', async () => {
    const { rerender } = render(
      <Shell pathname="/recommend">
        <ScrollRegion key="recommend" label="推荐" />
      </Shell>,
    );
    rerender(
      <Shell pathname="/settings">
        <ScrollRegion key="settings" label="设置" />
      </Shell>,
    );
    rerender(
      <Shell pathname="/recommend">
        <ScrollRegion key="recommend-back" label="推荐" />
      </Shell>,
    );
    const scroller = screen.getByTestId('scroller');

    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(scroller.scrollTop).toBe(0);
  });
});

/**
 * #688 PlayerBar → 全屏播放器封面共享元素：这里只验「同名元素在前后快照里不会同时出现」
 * 的时序契约（真实几何 morph 由浏览器 View Transitions 负责）。
 */

const audioPlayerMock = vi.hoisted(() => ({
  player: {
    getVolume: vi.fn(() => 80), getPosition: vi.fn(() => 0), getDuration: vi.fn(() => 0),
    getState: vi.fn(() => 'idle'), getCurrentSong: vi.fn(() => null),
    isPlaying: vi.fn(() => false), isPaused: vi.fn(() => false), isLoading: vi.fn(() => false),
    cancelLoad: vi.fn(), load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(),
    stop: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), destroy: vi.fn(),
  },
}));

vi.mock('@/renderer/services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));
vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn(async () => ({ success: true })) },
}));
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: vi.fn(async () => undefined) }));
vi.mock('@/renderer/hooks/useGlobalShortcuts', () => ({ useGlobalShortcuts: () => {} }));
vi.mock('@/renderer/components/TitleBar', () => ({ default: () => null }));
vi.mock('@/renderer/components/DownloadNotifications', () => ({ default: () => null }));
vi.mock('@/renderer/components/UpdateReadyDialog', () => ({ default: () => null }));
vi.mock('@/renderer/components/Sidebar', () => ({ default: () => null }));
vi.mock('@/renderer/components/PlayerBar', () => ({
  default: ({ onCoverClick }: { onCoverClick: () => void }) => (
    <button type="button" className="player-bar__cover" onClick={onCoverClick}>
      播放栏封面
    </button>
  ),
}));
vi.mock('@/renderer/pages/LyricsPage', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div className="lyrics-page">
      <div className="lyrics-page__cover" style={{ viewTransitionName: 'player-cover' }} />
      <button type="button" onClick={onBack}>收起播放器</button>
    </div>
  ),
}));

import App from '@/renderer/App';
import { usePlayerStore } from '@/renderer/store/playerStore';

const song = {
  id: 'n1',
  name: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  duration: 269,
  sourceType: 'netease',
  url: 'https://audio.example.com/n1.mp3',
  cover: 'https://cover.example.com/n1.jpg',
  lrc: '',
} as unknown as Song;

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/" element={<App />}>
          <Route path="discover" element={<div>发现页</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('PlayerBar → 全屏播放器封面共享元素（#688）', () => {
  beforeEach(() => {
    localStorage.clear();
    usePlayerStore.setState({ currentSong: song });
  });

  it('View Transitions 可用：打开/关闭时前后快照只有一个 player-cover', async () => {
    const snapshots: Array<{ phase: string; playerName: string; hasLyricsCover: boolean }> = [];
    const startViewTransition = vi.fn((update: () => void) => {
      const playerCover = document.querySelector<HTMLElement>('.player-bar__cover')!;
      snapshots.push({
        phase: 'old',
        playerName: playerCover.style.viewTransitionName,
        hasLyricsCover: Boolean(document.querySelector('.lyrics-page__cover')),
      });
      update();
      snapshots.push({
        phase: 'new',
        playerName: playerCover.style.viewTransitionName,
        hasLyricsCover: Boolean(document.querySelector('.lyrics-page__cover')),
      });
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn(),
      } as unknown as ViewTransition;
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition });
    try {
      renderApp();
      fireEvent.click(screen.getByRole('button', { name: '播放栏封面' }));
      expect(screen.getByText('收起播放器')).toBeInTheDocument();

      // 打开：旧快照 PlayerBar 持名、无全屏封面；新快照全屏封面持名、PlayerBar 已让位。
      expect(snapshots[0]).toEqual({ phase: 'old', playerName: 'player-cover', hasLyricsCover: false });
      expect(snapshots[1]).toEqual({ phase: 'new', playerName: '', hasLyricsCover: true });

      fireEvent.click(screen.getByRole('button', { name: '收起播放器' }));
      expect(screen.queryByText('收起播放器')).toBeNull();

      // 关闭：旧快照全屏封面持名；新快照 PlayerBar 接棒，随后清掉 inline name。
      expect(snapshots[2]).toEqual({ phase: 'old', playerName: '', hasLyricsCover: true });
      expect(snapshots[3]).toEqual({ phase: 'new', playerName: 'player-cover', hasLyricsCover: false });
      await waitFor(() =>
        expect(document.querySelector<HTMLElement>('.player-bar__cover')!.style.viewTransitionName).toBe(''),
      );
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  it('无 View Transitions API：直接切换并保持 PlayerBar 封面无残留 inline name', () => {
    renderApp();
    const playerCover = document.querySelector<HTMLElement>('.player-bar__cover')!;
    fireEvent.click(screen.getByRole('button', { name: '播放栏封面' }));
    expect(screen.getByText('收起播放器')).toBeInTheDocument();
    expect(playerCover.style.viewTransitionName).toBe('');

    fireEvent.click(screen.getByRole('button', { name: '收起播放器' }));
    expect(screen.queryByText('收起播放器')).toBeNull();
    expect(playerCover.style.viewTransitionName).toBe('');
  });
});
