import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/renderer/components/SongList', () => ({ default: () => <div data-testid="song-list" /> }));
vi.mock('@/renderer/components/AlbumGrid', () => ({ default: () => <div data-testid="album-grid" /> }));
vi.mock('@/renderer/hooks/useDownload', () => ({ useDownload: () => ({ download: vi.fn(), downloadBatch: vi.fn() }) }));
vi.mock('@/renderer/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => {} }));
vi.mock('@/renderer/services/playlistWriteAdapter', () => ({
  createDesktopPlaylistWriter: () => ({ createAndAdd: vi.fn(async () => ({ ok: true, added: 0 })) }),
}));
const playerState = { currentSong: null as any, isPlaying: false, play: vi.fn(), setCurrentPlaylist: vi.fn() };
vi.mock('@/renderer/store/playerStore', () => ({ usePlayerStore: (s: any) => s(playerState) }));
const favState = { favoriteIds: [] as string[], toggleFavorite: vi.fn() };
vi.mock('@/renderer/store/favoriteStore', () => ({ useFavoriteStore: (s: any) => s(favState) }));
const callMusicApi = vi.fn();
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: (...a: any[]) => callMusicApi(...a) }));
vi.mock('@/renderer/services/searchService', () => ({ searchService: { search: vi.fn() } }));
vi.mock('@/renderer/services/playableVersionAdapter', () => ({ resolvePlayableVersionForDesktop: async (s: any) => s }));
vi.mock('@/renderer/services/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ArtistDetailPage from '@/renderer/pages/ArtistDetailPage';
import HotlistDetailPage from '@/renderer/pages/HotlistDetailPage';

function renderAt(path: string, pattern: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path={pattern} element={element} /></Routes>
    </MemoryRouter>,
  );
}

describe('歌手详情（#702）', () => {
  it('唯一 h1、唯一主色 CTA、圆形媒体', async () => {
    callMusicApi.mockResolvedValue({ songs: [{ id: 's1', name: '晴天', sourceType: 'netease' }], total: 1 });
    renderAt('/artist/1', '/artist/:id', <ArtistDetailPage />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelectorAll('.ui-btn--primary').length).toBe(1);
    expect(screen.queryByText('返回')).toBeNull();
  });
});

describe('热榜详情（#702）', () => {
  it('唯一 h1、唯一主色 CTA、无局部返回', async () => {
    callMusicApi.mockResolvedValue([{ id: 's1', name: '晴天', sourceType: 'netease' }]);
    renderAt('/hotlist/netease', '/hotlist/:type', <HotlistDetailPage />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelectorAll('.ui-btn--primary').length).toBe(1);
  });
});
