import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LyricsPage from '@/renderer/pages/LyricsPage';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { router } from '@/renderer/router';

// 与既有用例同款：jsdom 下不碰 Howler / IPC
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

/**
 * #403：歌词页曾是 App.tsx 里的 state 视图切换（showLyrics）——URL 变了但主区域
 * 仍停在歌词页（侧边栏 / 搜索 / 前进后退都「点了没反应」）。现改为正式路由 /lyrics。
 */
describe('歌词页路由化（#403）', () => {
  beforeEach(() => {
    usePlayerStore.setState({ currentSong: null, lyrics: '', lyricsLoading: false });
  });

  it('router 注册了 /lyrics 子路由（不再依赖 App 的 state 视图切换）', () => {
    const children = (router.routes[0].children ?? []) as { path?: string }[];
    expect(children.some((r) => r.path === 'lyrics')).toBe(true);
  });

  it('缺省「返回」= 回上一页（App 不再传 onBack）', async () => {
    render(
      <MemoryRouter initialEntries={['/discover', '/lyrics']} initialIndex={1}>
        <Routes>
          <Route path="/discover" element={<div>发现页占位</div>} />
          <Route path="/lyrics" element={<LyricsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '返回' }));
    expect(await screen.findByText('发现页占位')).toBeTruthy();
  });

  it('直接打开 /lyrics（无历史）时「返回」兜底回 /discover', async () => {
    render(
      <MemoryRouter initialEntries={['/lyrics']}>
        <Routes>
          <Route path="/discover" element={<div>发现页占位</div>} />
          <Route path="/lyrics" element={<LyricsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '返回' }));
    expect(await screen.findByText('发现页占位')).toBeTruthy();
  });
});
