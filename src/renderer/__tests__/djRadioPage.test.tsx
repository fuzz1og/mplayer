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

const callMusicApi = vi.fn();
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: (...args: any[]) => callMusicApi(...args) }));

vi.mock('@/renderer/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => {} }));
vi.mock('@/renderer/services/playlistWriteAdapter', () => ({
  createDesktopPlaylistWriter: () => ({ createAndAdd: vi.fn(async () => ({ ok: true, added: 2 })) }),
}));
vi.mock('@/renderer/services/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import DjRadioDetailPage from '@/renderer/pages/DjRadioDetailPage';

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
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('DjRadioDetailPage（#742）', () => {
  it('渲染电台 Hero、节目期号与播放全部；不暴露收藏', async () => {
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getDjRadioDetail') return radio;
      if (method === 'getDjRadioPrograms') {
        return { programs: [program(126, '3457566808'), program(125, '3457566809')], total: 126, more: false };
      }
      throw new Error(`unexpected: ${method}`);
    });

    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(2));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('AI 陶喆');
    expect(screen.getByText('126')).toBeTruthy();
    expect(screen.getByText('125')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /收藏/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '播放全部' }));
    expect(playerState.setCurrentPlaylist).toHaveBeenCalledTimes(1);
    expect(playerState.play).toHaveBeenCalledWith(expect.objectContaining({ id: '3457566808' }));
  });

  it('电台不存在时显示错误态，不发节目请求', async () => {
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getDjRadioDetail') return null;
      if (method === 'getDjRadioPrograms') return { programs: [], total: 0, more: false };
      throw new Error(`unexpected: ${method}`);
    });
    renderPage();
    expect(await screen.findByText('电台不存在或加载失败')).toBeTruthy();
    expect(callMusicApi.mock.calls.some(([method]) => method === 'getDjRadioPrograms')).toBe(false);
  });
});
