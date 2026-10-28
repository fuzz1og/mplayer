import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * #694 评审：/queue 兼容页自己渲染 `<QueuePanel standalone>`，而 App 又常驻一块全局面板。
 * 深链 /queue 时从播放栏点「队列」→ 两块面板、双份 ESC 监听。修复后该路由只存在一块。
 */
describe('/queue 兼容路由', () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock('@/renderer/services/audioPlayer');
  });

  it('深链 /queue 后再从播放栏打开队列，仍只有一块面板；ESC 只关闭一次并回到来源页', async () => {
    vi.resetModules();
    const playerStub = {
      getVolume: () => 80, getPosition: () => 0, getDuration: () => 0, getState: () => 'idle',
      getCurrentSong: () => null, isPlaying: () => false, isPaused: () => false, isLoading: () => false,
      cancelLoad: vi.fn(), load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(),
      stop: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), destroy: vi.fn(),
    };
    vi.doMock('@/renderer/services/audioPlayer', () => ({
      getGlobalPlayer: () => playerStub,
      destroyGlobalPlayer: vi.fn(),
    }));
    vi.doMock('@/renderer/services/IpcClient', () => ({ IpcClient: { invoke: vi.fn(async () => ({ success: true })) } }));
    vi.doMock('@/renderer/services/callMusicApi', () => ({ callMusicApi: vi.fn(async () => undefined) }));
    vi.doMock('@/renderer/hooks/useGlobalShortcuts', () => ({ useGlobalShortcuts: () => {} }));
    vi.doMock('@/renderer/components/TitleBar', () => ({ default: () => null }));
    vi.doMock('@/renderer/components/Sidebar', () => ({ default: () => null }));
    vi.doMock('@/renderer/components/DownloadNotifications', () => ({ default: () => null }));
    vi.doMock('@/renderer/components/UpdateReadyDialog', () => ({ default: () => null }));
    vi.doMock('@/renderer/pages/LyricsPage', () => ({ default: () => null }));
    // 播放栏队列按钮就是 openQueuePanel 的入口：点它 = 真实路径上的第二次「打开」
    vi.doMock('@/renderer/components/PlayerBar', () => ({
      default: ({ onQueueClick }: { onQueueClick: () => void }) => (
        <button type="button" onClick={onQueueClick}>播放栏队列</button>
      ),
    }));

    const { MemoryRouter, Route, Routes } = await import('react-router-dom');
    const { default: App } = await import('@/renderer/App');
    const { default: QueuePage } = await import('@/renderer/pages/QueuePage');

    render(
      <MemoryRouter initialEntries={['/recommend', '/queue']} initialIndex={1}>
        <Routes>
          <Route path="/" element={<App />}>
            <Route path="recommend" element={<div>推荐页</div>} />
            <Route path="queue" element={<QueuePage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const panels = () => document.querySelectorAll('[data-queue-panel]');
    expect(panels()).toHaveLength(1);

    // 真实触发路径：深链停在 /queue 时点播放栏「队列」→ 修复前会并排出现第二块面板
    fireEvent.click(screen.getByRole('button', { name: '播放栏队列' }));
    expect(panels()).toHaveLength(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panels()).toHaveLength(0);
    expect(await screen.findByText('推荐页')).toBeInTheDocument();
  });
});
