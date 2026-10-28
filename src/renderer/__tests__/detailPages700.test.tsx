import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** 专辑详情 + 发现歌单详情（#700/#694）：同一套详情页模板，批量下载必须打到真实回调。 */

const downloadBatch = vi.fn();
vi.mock('@/renderer/hooks/useDownload', () => ({
  useDownload: () => ({ download: vi.fn(), downloadBatch }),
}));

const playerState = { currentSong: null as any, isPlaying: false, play: vi.fn(), setCurrentPlaylist: vi.fn() };
vi.mock('@/renderer/store/playerStore', () => ({ usePlayerStore: (s: any) => s(playerState) }));

const favState = { favoriteIds: [] as string[], toggleFavorite: vi.fn() };
vi.mock('@/renderer/store/favoriteStore', () => ({ useFavoriteStore: (s: any) => s(favState) }));

const callMusicApi = vi.fn();
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: (...a: any[]) => callMusicApi(...a) }));

vi.mock('@/renderer/services/playlistWriteAdapter', () => ({
  createDesktopPlaylistWriter: () => ({ createAndAdd: vi.fn(async () => ({ ok: true, added: 0 })) }),
}));

vi.mock('@/renderer/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => {} }));

vi.mock('@/renderer/services/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AlbumDetailPage from '@/renderer/pages/AlbumDetailPage';
import DiscoverPlaylistDetailPage from '@/renderer/pages/DiscoverPlaylistDetailPage';

beforeEach(() => {
  callMusicApi.mockReset();
  downloadBatch.mockReset();
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

function renderAt(path: string, pattern: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const SONGS = [
  { id: 's1', name: '晴天', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 269, sourceType: 'netease' },
  { id: 's2', name: '七里香', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 299, sourceType: 'netease' },
] as any[];

/** 模板口径（#694）：无表头、46px library 行、单行工具条、恰好一个主色 CTA。 */
function expectDetailTemplate(container: HTMLElement) {
  expect(container.querySelectorAll('h1').length).toBe(1);
  expect(container.querySelectorAll('.ui-btn--primary').length).toBe(1);
  expect(container.querySelectorAll('thead').length).toBe(0);
  expect(container.querySelectorAll('.song-list__head').length).toBe(0);
  expect(container.querySelectorAll('.song-list__header').length).toBe(0);
  expect(container.querySelectorAll('[data-detail-toolbar]').length).toBe(1);
  expect(container.querySelectorAll('.song-list[data-density="library"]').length).toBe(1);
  const row = container.querySelector('.song-row') as HTMLElement;
  expect(row).toBeTruthy();
  expect(row.style.getPropertyValue('--song-row-height')).toBe('46px');
  expect(row.style.getPropertyValue('--song-row-cover')).toBe('30px');
}

describe('专辑详情（#700）', () => {
  it('详情页模板 + 批量下载真的接到 downloadBatch', async () => {
    callMusicApi.mockResolvedValue({
      album: { name: '叶惠美', artist: '周杰伦', picUrl: '', publishTime: 0 },
      songs: SONGS,
    });
    const { container } = renderAt('/album/1', '/album/:id', <AlbumDetailPage />);
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(2));
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expectDetailTemplate(container);

    // 按需选择：普通浏览没有复选框列，点「选择」才出现
    expect(container.querySelector('.song-row__check')).toBeNull();
    fireEvent.click(container.querySelector('.detail-toolbar__toggle') as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll('.song-row__check').length).toBe(2));
    fireEvent.click(container.querySelector('.song-row__check input') as HTMLElement);
    await waitFor(() => expect(container.textContent).toContain('已选择 1 项'));
    fireEvent.click(container.querySelector('.detail-toolbar__batch-btn') as HTMLElement);
    expect(downloadBatch).toHaveBeenCalledTimes(1);
    expect(downloadBatch.mock.calls[0][0].map((song: any) => song.id)).toEqual(['s1']);
  });

  it('不再渲染局部返回按钮（标题栏是唯一返回所有者）', async () => {
    callMusicApi.mockResolvedValue({ album: { name: 'A', artist: 'B', picUrl: '' }, songs: [] });
    renderAt('/album/1', '/album/:id', <AlbumDetailPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('返回')).toBeNull();
  });
});

describe('发现歌单详情（#700）', () => {
  it('详情页模板 + 无局部返回 + 批量下载接真实回调', async () => {
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getPlaylistDetail') {
        return { id: 'p1', name: '测试歌单', creator: { nickname: 'me' }, playCount: 1, trackCount: 2, tags: [], coverImgUrl: '', description: '' };
      }
      return { songs: SONGS, total: SONGS.length };
    });
    const { container } = renderAt('/discover/playlist/p1', '/discover/playlist/:id', <DiscoverPlaylistDetailPage />);
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(2));
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expectDetailTemplate(container);
    expect(screen.queryByText('返回')).toBeNull();

    fireEvent.click(container.querySelector('.detail-toolbar__toggle') as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll('.song-row__check').length).toBe(2));
    fireEvent.click(container.querySelector('.song-row__check input') as HTMLElement);
    await waitFor(() => expect(container.textContent).toContain('已选择 1 项'));
    fireEvent.click(container.querySelector('.detail-toolbar__batch-btn') as HTMLElement);
    expect(downloadBatch).toHaveBeenCalledTimes(1);
  });
});
