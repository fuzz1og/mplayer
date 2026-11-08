import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const downloadBatch = vi.fn();
vi.mock('@/renderer/hooks/useDownload', () => ({
  useDownload: () => ({ download: vi.fn(), downloadBatch }),
}));

const playerState = {
  currentSong: null as any,
  isPlaying: false,
  play: vi.fn(),
  setCurrentPlaylist: vi.fn(),
};
vi.mock('@/renderer/store/playerStore', () => ({ usePlayerStore: (selector: any) => selector(playerState) }));
const favoriteState = { favoriteIds: [] as string[], toggleFavorite: vi.fn() };
vi.mock('@/renderer/store/favoriteStore', () => ({ useFavoriteStore: (selector: any) => selector(favoriteState) }));

const callMusicApi = vi.fn();
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: (...args: any[]) => callMusicApi(...args) }));

vi.mock('@/renderer/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => {} }));
vi.mock('@/renderer/services/playlistWriteAdapter', () => ({
  createDesktopPlaylistWriter: () => ({ createAndAdd: vi.fn(async () => ({ ok: true, added: 2 })) }),
}));
vi.mock('@/renderer/services/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import DjRadioDetailPage from '@/renderer/pages/DjRadioDetailPage';
import { toast } from '@/renderer/services/toastStore';

const radio = {
  id: '1003897323',
  name: 'AI 陶喆',
  picUrl: 'https://p2.music.126.net/radio.jpg',
  desc: '电台简介',
  dj: { userId: '79952226', nickname: '邪热搜索', avatarUrl: '' },
  programCount: 133,
  subCount: 11625,
  shareCount: 87,
  commentCount: 192,
  createTime: 1713869429607,
  lastProgramCreateTime: 1793794952345,
  lastProgramId: '3731935266',
  category: '创作翻唱',
  secondCategory: '歌曲翻唱',
  sourceType: 'netease' as const,
};

const program = (serialNum: number, id: string) => ({
  id,
  name: `第 ${serialNum} 期`,
  artist: '邪热搜索',
  album: 'AI 陶喆',
  duration: 191,
  sourceType: 'netease' as const,
  url: '',
  cover: 'https://p2.music.126.net/program.jpg',
  lrc: '',
  programId: `p${serialNum}`,
  radioId: '1003897323',
  serialNum,
  createTime: 1793794952345,
  listenerCount: 2195,
  description: '单期简介',
  coverUrl: 'https://p2.music.126.net/program.jpg',
});

const okDetail = (data: unknown = radio) => ({ ok: true, radio: data });
const okPrograms = (programs: unknown[], total = programs.length, more = false) =>
  ({ ok: true, page: { programs, total, more } });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/djradio/1003897323']}>
      <Routes>
        <Route path="/djradio/:id" element={<DjRadioDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  callMusicApi.mockReset();
  downloadBatch.mockReset();
  playerState.play.mockReset();
  playerState.setCurrentPlaylist.mockReset();
  favoriteState.favoriteIds = [];
  favoriteState.toggleFavorite.mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('DjRadioDetailPage（#742）', () => {
  it('渲染电台 Hero 与节目期号；复用收藏、隐藏换源、暴露单期简介', async () => {
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getDjRadioDetailRouted') return okDetail();
      if (method === 'getDjRadioProgramsRouted') {
        return okPrograms([program(126, '3457566808'), program(125, '3457566809')], 126);
      }
      throw new Error(`unexpected: ${method}`);
    });

    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(2));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('AI 陶喆');
    expect(screen.getByText('126')).toBeTruthy();
    expect(screen.getByText('125')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /更多操作/ })).toHaveLength(2);
    expect(container.querySelectorAll('.song-row[title="单期简介"]')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: /更多操作/ })[0]);
    const favorite = screen.getByRole('menuitem', { name: /收藏/ });
    expect(screen.queryByRole('menuitem', { name: '换源完整版' })).toBeNull();
    fireEvent.click(favorite);
    expect(favoriteState.toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: '3457566808' }));
  });

  it('播放全部串行收齐 126 期后建队列，且不用首屏 30 期顶替全量', async () => {
    callMusicApi.mockImplementation(async (method: string, _source: string, _id: string, _offset: number, limit: number) => {
      if (method === 'getDjRadioDetailRouted') return okDetail();
      if (method === 'getDjRadioProgramsRouted') {
        if (limit === 30) return okPrograms([program(126, '3457566808')], 126);
        return okPrograms(Array.from({ length: 126 }, (_, index) => program(126 - index, `song-${index}`)), 126);
      }
      throw new Error(`unexpected: ${method}`);
    });
    renderPage();
    const playAll = await screen.findByRole('button', { name: '播放全部' });
    fireEvent.click(playAll);
    await waitFor(() => expect(playerState.setCurrentPlaylist).toHaveBeenCalledTimes(1));
    const [queue, index] = playerState.setCurrentPlaylist.mock.calls[0];
    expect(queue).toHaveLength(126);
    expect(index).toBe(0);
    expect(playerState.play).toHaveBeenCalledWith(expect.objectContaining({ id: 'song-0' }));
    expect(callMusicApi.mock.calls.filter(([method, , , , limit]) =>
      method === 'getDjRadioProgramsRouted' && limit === 200)).toHaveLength(1);
  });

  it('播放全部失败时显示可读 toast，不建半截队列', async () => {
    let allAttempts = 0;
    callMusicApi.mockImplementation(async (method: string, _source: string, _id: string, _offset: number, limit: number) => {
      if (method === 'getDjRadioDetailRouted') return okDetail();
      if (method === 'getDjRadioProgramsRouted') {
        if (limit === 30) return okPrograms([program(126, '3457566808')], 126);
        allAttempts += 1;
        return { ok: false, reason: 'failed', message: 'code=406 操作频繁，请稍后重试' };
      }
      throw new Error(`unexpected: ${method}`);
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '播放全部' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('播放全部失败，请稍后重试'));
    expect(allAttempts).toBe(1);
    expect(playerState.setCurrentPlaylist).not.toHaveBeenCalled();
  });

  it('详情 404 / 406 / 网络错误 / 不支持分别显示具体文案', async () => {
    const cases = [
      { reason: 'not-found', message: '404', expected: '电台不存在' },
      { reason: 'failed', message: 'code=406 操作频繁，请稍后重试', expected: '操作频繁，请稍后重试' },
      { reason: 'failed', message: 'network down', expected: '加载失败' },
      { reason: 'unsupported', message: 'unsupported', expected: '源不支持' },
    ];
    for (const item of cases) {
      callMusicApi.mockImplementation(async (method: string) => {
        if (method === 'getDjRadioDetailRouted') return { ok: false, reason: item.reason, message: item.message };
        return okPrograms([], 0);
      });
      const { unmount } = renderPage();
      expect(await screen.findByText(item.expected)).toBeTruthy();
      expect(callMusicApi.mock.calls.some(([method]) => method === 'getDjRadioProgramsRouted')).toBe(false);
      unmount();
      cleanup();
    }
  });

  it('电台不存在时显示错误态，不发节目请求', async () => {
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getDjRadioDetailRouted') return { ok: false, reason: 'not-found', message: '404' };
      if (method === 'getDjRadioProgramsRouted') return okPrograms([], 0);
      throw new Error(`unexpected: ${method}`);
    });
    renderPage();
    expect(await screen.findByText('电台不存在')).toBeTruthy();
    expect(callMusicApi.mock.calls.some(([method]) => method === 'getDjRadioProgramsRouted')).toBe(false);
  });

  it('节目 406 与 unsupported 分别显示文案', async () => {
    const cases = [
      { outcome: { ok: false, reason: 'failed', message: 'code=406 操作频繁，请稍后重试' }, expected: '操作频繁，请稍后重试' },
      { outcome: { ok: false, reason: 'unsupported', message: 'unsupported' }, expected: '源不支持' },
    ];
    for (const item of cases) {
      callMusicApi.mockImplementation(async (method: string) => {
        if (method === 'getDjRadioDetailRouted') return okDetail();
        if (method === 'getDjRadioProgramsRouted') return item.outcome;
        throw new Error(`unexpected: ${method}`);
      });
      const { unmount } = renderPage();
      expect(await screen.findByText(item.expected)).toBeTruthy();
      unmount();
      cleanup();
    }
  });
});
