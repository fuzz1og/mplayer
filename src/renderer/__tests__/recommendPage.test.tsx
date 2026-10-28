import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DiscoverPlaylist, Song } from '@mplayer/core';
import RecommendPage from '@/renderer/pages/RecommendPage';
import { usePlayerStore } from '@/renderer/store/playerStore';

const callMusicApiMock = vi.fn();

vi.mock('@/renderer/services/callMusicApi', () => ({
  callMusicApi: (...args: unknown[]) => callMusicApiMock(...args),
}));

vi.mock('@/renderer/services/playableVersionAdapter', () => ({
  resolvePlayableVersionForDesktop: vi.fn(async (song: Song) => song),
}));

const song = (id: string, name: string, artist: string, album: string): Song => ({
  id,
  name,
  artist,
  album,
  duration: 200,
  sourceType: 'netease',
  url: 'https://audio.example.com/' + id + '.mp3',
  cover: 'https://cover.example.com/' + id + '.jpg',
  lrc: '',
});

const songs = [
  song('netease:1', '推荐歌1', '歌手甲', '专辑甲'),
  song('netease:2', '推荐歌2', '歌手乙', '专辑乙'),
  song('netease:3', '推荐歌3', '歌手丙', '专辑丙'),
  song('netease:4', '推荐歌4', '歌手丁', '专辑丁'),
  song('netease:5', '推荐歌5', '歌手戊', '专辑戊'),
  song('netease:6', '推荐歌6', '歌手己', '专辑己'),
];

const playlists: DiscoverPlaylist[] = [
  { id: 11, name: '歌单甲', coverImgUrl: '', playCount: 1234, trackCount: 12, creator: { nickname: '编辑' }, tags: [], description: '' },
  { id: 12, name: '歌单乙', coverImgUrl: '', playCount: 4567, trackCount: 20, creator: { nickname: '编辑' }, tags: [], description: '' },
  { id: 13, name: '歌单丙', coverImgUrl: '', playCount: 89, trackCount: 8, creator: { nickname: '编辑' }, tags: [], description: '' },
];

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
};

const renderPage = () => render(
  <MemoryRouter initialEntries={['/recommend']}>
    <RecommendPage />
    <LocationProbe />
  </MemoryRouter>,
);

const waitForPage = async () => {
  await waitFor(() => expect(screen.getAllByText('推荐歌1').length).toBeGreaterThan(0));
};

describe('推荐页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'getRecommendedSongs') return songs;
      if (method === 'getRecommendedPlaylists') return playlists;
      return [];
    });
    usePlayerStore.setState({ currentSong: null, isPlaying: false, currentPlaylist: [], currentPlaylistIndex: -1 });
  });

  it('三类内容在同一页面流：今日主打 / 推荐歌曲 / 推荐歌单，只有一个 PageHeader', async () => {
    const { container } = renderPage();
    await waitForPage();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: '推荐' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '今日主打' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '推荐歌曲' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '推荐歌单' })).toBeInTheDocument();

    // 推荐歌曲是 SongList 普通列表：5 行；歌单是内容网格：3 个 tile
    expect(container.querySelectorAll('.song-row')).toHaveLength(5);
    expect(container.querySelectorAll('.rec-playlist')).toHaveLength(3);

    // 唯一页面滚动容器（其余区块都在这一个容器里）
    expect(container.querySelectorAll('[data-scroll-container]')).toHaveLength(1);
  });

  it('播放推荐歌曲建立当前批次的展示队列并从第一首开始', async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    const originalPlay = usePlayerStore.getState().play;
    usePlayerStore.setState({ play: playSpy });
    try {
      renderPage();
      await waitForPage();
      await userEvent.click(screen.getByRole('button', { name: '播放推荐歌曲' }));

      expect(playSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'netease:1' }));
      const state = usePlayerStore.getState();
      expect(state.currentPlaylist.map((item) => item.id)).toEqual(songs.slice(0, 5).map((item) => item.id));
      expect(state.currentPlaylistIndex).toBe(0);
    } finally {
      usePlayerStore.setState({ play: originalPlay });
    }
  });

  it('点歌曲行播放时回传当前展示队列与组内下标（D2）', async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    const originalPlay = usePlayerStore.getState().play;
    usePlayerStore.setState({ play: playSpy });
    try {
      renderPage();
      await waitForPage();
      const row = screen.getAllByText('推荐歌2').find((el) => el.closest('.song-row'))?.closest('.song-row') as HTMLElement;
      fireEvent.click(row.querySelector('.song-row__cover-play') as HTMLElement);

      await waitFor(() => expect(playSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'netease:2' })));
      const state = usePlayerStore.getState();
      expect(state.currentPlaylist.map((item) => item.id)).toEqual(songs.slice(0, 5).map((item) => item.id));
      expect(state.currentPlaylistIndex).toBe(1);
    } finally {
      usePlayerStore.setState({ play: originalPlay });
    }
  });

  it('点击推荐歌单进入歌单详情', async () => {
    renderPage();
    await waitForPage();
    await userEvent.click(screen.getByRole('button', { name: '打开歌单 歌单甲' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/discover-playlist/11');
  });

  it('不使用旧黄色标签或浮起卡片语言', async () => {
    const { container } = renderPage();
    await waitForPage();
    expect(container.querySelector('.daily__badge')).toBeNull();
    expect(container.querySelector('.pl-card')).toBeNull();
  });
});
