import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Song, Artist } from '@mplayer/core';
import { ipcMusicApi } from '@/renderer/services/IpcMusicApi';
import { IpcClient } from '@/renderer/services/IpcClient';
import DiscoverPageV2 from '@/renderer/pages/DiscoverPageV2';
import { useSearchStore } from '@/renderer/store/searchStore';
import { usePlayerStore } from '@/renderer/store/playerStore';

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

vi.mock('@/renderer/services/IpcMusicApi', () => ({
  ipcMusicApi: {
    searchSongs: vi.fn(async () => []),
    searchAllSources: vi.fn(async () => []),
    searchArtists: vi.fn(async () => []),
    getAudioUrl: vi.fn(async () => 'https://resolved.example.com/a.mp3'),
    getSodaPlayableUrl: vi.fn(async () => ''),
  },
}));

function song(id: string, name = '晴天'): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: `https://audio.example.com/${id}.mp3`, cover: '', lrc: '',
  };
}

const searchArtistsMock = vi.mocked(ipcMusicApi.searchArtists);

beforeEach(() => {
  searchArtistsMock.mockReset();
  searchArtistsMock.mockResolvedValue([
    { id: '123', name: '周杰伦', picUrl: '', alias: [], albumSize: 10, musicSize: 100, sourceType: 'netease' },
  ]);
  useSearchStore.setState({ currentKeyword: '', preferredTab: 'songs', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false, error: null });
  usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null, isPlaying: false, isLoading: false });
  vi.mocked(IpcClient.invoke).mockClear();
});

describe('搜索结果 单曲/歌手 tab', () => {
  it('查看歌手入口落在歌手 tab，歌手卡片可进入详情页', async () => {
    useSearchStore.setState({ currentKeyword: '周杰伦', preferredTab: 'artists', sourceType: 'all', songs: [song('1')], groups: [], loading: false, hasMore: false });

    render(
      <MemoryRouter initialEntries={['/discover']}>
        <Routes>
          <Route path="/discover" element={<DiscoverPageV2 />} />
          <Route path="/artist/:id" element={<div data-testid="artist-detail">歌手详情</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /歌手/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '查看歌手: 周杰伦' }));

    expect(await screen.findByTestId('artist-detail')).toBeInTheDocument();
  });

  it('普通新关键词默认落在单曲 tab，不显示歌手卡片', async () => {
    useSearchStore.setState({
      currentKeyword: '晴天', preferredTab: 'songs', sourceType: 'all', songs: [],
      groups: [{ key: 'netease:1', name: '晴天', artist: '周杰伦', songs: [song('1')] }],
      loading: false, hasMore: false,
    });

    render(
      <MemoryRouter initialEntries={['/discover']}>
        <Routes>
          <Route path="/discover" element={<DiscoverPageV2 />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /单曲/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '查看歌手: 周杰伦' })).toBeNull();
  });

  it('慢响应的旧关键词不覆盖新关键词的歌手结果（序号守卫）', async () => {
    useSearchStore.setState({
      currentKeyword: '周杰伦', preferredTab: 'songs', sourceType: 'all', songs: [],
      groups: [], loading: false, hasMore: false,
    });
    let resolveOld!: (artists: Artist[]) => void;
    const oldPromise = new Promise<Artist[]>((resolve) => { resolveOld = resolve; });
    searchArtistsMock
      .mockResolvedValueOnce(oldPromise)
      .mockResolvedValueOnce([
        { id: '456', name: '林俊杰', picUrl: '', alias: [], albumSize: 20, musicSize: 200, sourceType: 'netease' },
      ]);

    render(
      <MemoryRouter initialEntries={['/discover']}>
        <Routes>
          <Route path="/discover" element={<DiscoverPageV2 />} />
          <Route path="/artist/:id" element={<div data-testid="artist-detail">歌手详情</div>} />
        </Routes>
      </MemoryRouter>
    );

    // 第一次搜索（周杰伦）挂起，展示加载态
    await waitFor(() => expect(searchArtistsMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /歌手/ }));
    expect(screen.getByText(/正在搜索歌手/)).toBeInTheDocument();

    // 关键词切到林俊杰，新响应先到
    useSearchStore.setState({ currentKeyword: '林俊杰' });
    // 新关键词默认重置回单曲 tab，再切到歌手 tab 查看结果
    await waitFor(() => expect(screen.getByRole('button', { name: /单曲/ })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: /歌手/ }));
    expect(await screen.findByRole('button', { name: '查看歌手: 林俊杰' })).toBeInTheDocument();

    // 旧响应姗姗来迟：序号守卫应丢弃，不覆盖新结果
    resolveOld([
      { id: '123', name: '周杰伦', picUrl: '', alias: [], albumSize: 10, musicSize: 100, sourceType: 'netease' },
    ]);
    await waitFor(() => expect(screen.queryByRole('button', { name: '查看歌手: 周杰伦' })).toBeNull());
    expect(screen.getByRole('button', { name: '查看歌手: 林俊杰' })).toBeInTheDocument();
  });

  it('单曲 tab 搜索失败时显示错误态', async () => {
    useSearchStore.setState({
      currentKeyword: '晴天', preferredTab: 'songs', sourceType: 'all', songs: [], groups: [],
      loading: false, hasMore: false, error: '搜索失败，请稍后重试',
    });

    render(
      <MemoryRouter initialEntries={['/discover']}>
        <Routes>
          <Route path="/discover" element={<DiscoverPageV2 />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('搜索失败，请稍后重试')).toBeInTheDocument();
  });
});
