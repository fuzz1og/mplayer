import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const songListProps: any[] = [];
vi.mock('@/renderer/components/SongList', () => ({
  default: (props: any) => {
    songListProps.push(props);
    return <div data-testid="song-list" />;
  },
}));

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
  songListProps.length = 0;
  callMusicApi.mockReset();
  downloadBatch.mockReset();
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

describe('专辑详情（#700）', () => {
  it('唯一 h1 + 唯一主色 CTA，且批量下载真的接到 downloadBatch', async () => {
    callMusicApi.mockResolvedValue({
      album: { name: '叶惠美', artist: '周杰伦', picUrl: '', publishTime: 0 },
      songs: [{ id: 's1', name: '晴天', sourceType: 'netease', duration: 269 }],
    });
    renderAt('/album/1', '/album/:id', <AlbumDetailPage />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelectorAll('.ui-btn--primary').length).toBe(1);
    const props = songListProps.at(-1);
    expect(props.onBatchDownload).toBe(downloadBatch);
    expect(props.showCheckbox).toBeUndefined();
  });

  it('不再渲染局部返回按钮（标题栏是唯一返回所有者）', async () => {
    callMusicApi.mockResolvedValue({ album: { name: 'A', artist: 'B', picUrl: '' }, songs: [] });
    renderAt('/album/1', '/album/:id', <AlbumDetailPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('返回')).toBeNull();
  });
});

describe('发现歌单详情（#700）', () => {
  it('唯一 h1 + 无局部返回 + 批量下载接真实回调', async () => {
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getPlaylistDetail') {
        return { id: 'p1', name: '测试歌单', creator: { nickname: 'me' }, playCount: 1, trackCount: 1, tags: [], coverImgUrl: '', description: '' };
      }
      return { songs: [{ id: 's1', name: '晴天', sourceType: 'netease' }], total: 1 };
    });
    renderAt('/discover/playlist/p1', '/discover/playlist/:id', <DiscoverPlaylistDetailPage />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(screen.queryByText('返回')).toBeNull();
    const props = songListProps.at(-1);
    expect(props.onBatchDownload).toBe(downloadBatch);
  });
});
