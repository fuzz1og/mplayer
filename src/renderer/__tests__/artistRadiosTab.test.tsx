import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Artist, DjRadio } from '@mplayer/core';
import ArtistDetailPage from '@/renderer/pages/ArtistDetailPage';

const callMusicApi = vi.fn();
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: (...args: any[]) => callMusicApi(...args) }));
vi.mock('@/renderer/hooks/useDownload', () => ({
  useDownload: () => ({ download: vi.fn(), downloadBatch: vi.fn() }),
}));
vi.mock('@/renderer/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => {} }));
vi.mock('@/renderer/services/playlistWriteAdapter', () => ({
  createDesktopPlaylistWriter: () => ({ createAndAdd: vi.fn(async () => ({ ok: true, added: 0 })) }),
}));
vi.mock('@/renderer/services/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const playerState = {
  currentSong: null as any,
  isPlaying: false,
  play: vi.fn(),
  setCurrentPlaylist: vi.fn(),
};
vi.mock('@/renderer/store/playerStore', () => ({ usePlayerStore: (selector: any) => selector(playerState) }));
const favoriteState = { favoriteIds: [] as string[], toggleFavorite: vi.fn() };
vi.mock('@/renderer/store/favoriteStore', () => ({ useFavoriteStore: (selector: any) => selector(favoriteState) }));
vi.mock('@/renderer/services/searchService', () => ({ searchService: { search: vi.fn() } }));
vi.mock('@/renderer/services/playableVersionAdapter', () => ({
  resolvePlayableVersionForDesktop: async (song: any) => song,
}));

const artistWithAccount: Artist = {
  id: '12084453',
  name: '邪热搜索',
  picUrl: '',
  alias: [],
  albumSize: 11,
  musicSize: 15,
  sourceType: 'netease',
  accountId: '79952226',
};

const radio: DjRadio = {
  id: '1003897323',
  name: 'AI 陶喆',
  picUrl: '',
  desc: '电台简介',
  dj: { userId: '79952226', nickname: '邪热搜索', avatarUrl: '' },
  programCount: 133,
  subCount: 11625,
  shareCount: 0,
  commentCount: 0,
  createTime: 0,
  lastProgramCreateTime: 0,
  lastProgramId: '',
  category: '创作翻唱',
  sourceType: 'netease',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/artist/12084453']}>
      <Routes>
        <Route path="/artist/:id" element={<ArtistDetailPage />} />
        <Route path="/djradio/:id" element={<div data-testid="djradio-detail">电台详情</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const radioCalls = () => callMusicApi.mock.calls.filter((call) => call[0] === 'getArtistRadios');

beforeEach(() => {
  callMusicApi.mockReset();
  callMusicApi.mockImplementation(async (method: string) => {
    if (method === 'getArtistSongs') {
      return {
        songs: [{
          id: '1', name: '晴天', artist: '邪热搜索', album: '', duration: 200,
          sourceType: 'netease', url: '', cover: '', lrc: '',
        }],
        total: 1,
      };
    }
    if (method === 'getArtistInfo') return artistWithAccount;
    if (method === 'getArtistRadios') return { radios: [radio], total: 1, more: false, subCount: 0 };
    throw new Error(`unexpected: ${method}`);
  });
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('歌手页 电台分段（#742）', () => {
  it('按 accountId 取该歌手发布的电台，并可进入详情', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: '邪热搜索' })).toBeInTheDocument();
    const radioTab = await screen.findByRole('radio', { name: '电台' });
    await waitFor(() => expect(radioCalls()).toHaveLength(1));
    expect(radioCalls()[0]).toEqual(['getArtistRadios', 'netease', '79952226']);

    fireEvent.click(radioTab);
    expect(await screen.findByText('共 1 个电台')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI 陶喆' }));
    expect(await screen.findByTestId('djradio-detail')).toBeInTheDocument();
  });

  it('无 accountId 的歌手不显示电台分段，也不发电台请求', async () => {
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getArtistSongs') return { songs: [], total: 0 };
      if (method === 'getArtistInfo') return { ...artistWithAccount, accountId: undefined };
      throw new Error(`unexpected: ${method}`);
    });
    renderPage();

    await waitFor(() => expect(callMusicApi.mock.calls.some((call) => call[0] === 'getArtistInfo')).toBe(true));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('邪热搜索'));
    expect(screen.queryByRole('radio', { name: '电台' })).toBeNull();
    expect(radioCalls()).toHaveLength(0);
  });
});
