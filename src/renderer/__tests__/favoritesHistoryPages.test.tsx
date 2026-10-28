import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const songListProps: any[] = [];

vi.mock('@/renderer/components/SongList', () => ({
  default: (props: any) => {
    songListProps.push(props);
    return <div data-testid="song-list" data-empty={props.emptyText} />;
  },
}));

const albumGridProps: any[] = [];
vi.mock('@/renderer/components/AlbumGrid', () => ({
  default: (props: any) => {
    albumGridProps.push(props);
    return (
      <div data-testid="album-grid">
        {props.albums.map((album: any) => (
          <button key={album.id} onClick={() => props.onAlbumClick?.(album)}>{album.name}</button>
        ))}
      </div>
    );
  },
}));

vi.mock('@/renderer/components/ArtistCard', () => ({
  default: ({ artist, onClick }: any) => <button onClick={onClick}>{artist.name}</button>,
}));

const favoritesState = {
  favorites: [] as any[],
  loadFavorites: vi.fn(),
  toggleFavorite: vi.fn(),
};
vi.mock('@/renderer/store/favoriteStore', () => ({
  useFavoriteStore: Object.assign(
    (selector: any) => selector(favoritesState),
    { getState: () => favoritesState, setState: vi.fn() },
  ),
}));

const playerState = {
  currentSong: null as any,
  isPlaying: false,
  play: vi.fn(),
  setCurrentPlaylist: vi.fn(),
};
vi.mock('@/renderer/store/playerStore', () => ({
  usePlayerStore: (selector: any) => selector(playerState),
}));

vi.mock('@/renderer/hooks/useDownload', () => ({
  useDownload: () => ({ download: vi.fn(), downloadBatch: vi.fn() }),
}));

const invoke = vi.fn();
vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: (...args: any[]) => invoke(...args) },
}));

vi.mock('@/renderer/services/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/renderer/utils/songCoverRefresh', () => ({
  refreshSongCover: vi.fn(async () => null),
}));

import FavoritesPage from '@/renderer/pages/FavoritesPage';
import HistoryPage from '@/renderer/pages/HistoryPage';

const song = (id: string, name: string, artist: string, album: string) => ({
  id,
  name,
  artist,
  album,
  duration: 240,
  sourceType: 'netease',
  url: '',
  cover: '',
  lrc: '',
});

const segmentedValues = () =>
  Array.from(document.querySelectorAll('[role="radio"]')).map((el) => el.textContent?.trim());

beforeEach(() => {
  songListProps.length = 0;
  albumGridProps.length = 0;
  playerState.play.mockReset();
  playerState.setCurrentPlaylist.mockReset();
  invoke.mockReset();
});

describe('我喜欢的音乐（#694）', () => {
  it('页头是「我喜欢的音乐」，播放全部是唯一主色 CTA 且列表不再常驻复选框', () => {
    favoritesState.favorites = [{ id: 's1', name: '晴天', sourceType: 'netease' }];
    render(<FavoritesPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('我喜欢的音乐');
    const primary = document.querySelectorAll('.ui-btn--primary');
    expect(primary.length).toBe(1);
    expect(primary[0].textContent).toContain('播放全部');
    expect(songListProps.at(-1).showCheckbox).toBeUndefined();
  });

  it('空收藏时播放全部禁用，空态文案可读', () => {
    favoritesState.favorites = [];
    render(<FavoritesPage />);
    const primary = document.querySelector('.ui-btn--primary') as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(songListProps.at(-1).emptyText).toContain('还没有喜欢的歌曲');
  });

  it('内容库视角恒为三段：歌曲 / 专辑 / 歌手，默认歌曲', () => {
    favoritesState.favorites = [song('s1', '晴天', '周杰伦', '叶惠美')];
    render(<FavoritesPage />);
    expect(segmentedValues()).toEqual(['歌曲', '专辑', '歌手']);
    expect(screen.getByRole('radio', { name: '歌曲' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('song-list')).toBeInTheDocument();
  });

  it('「专辑」段从收藏歌曲按 album 聚合，复用 AlbumGrid；点卡片按该组建队列播放', () => {
    const first = song('s1', '晴天', '周杰伦', '叶惠美');
    const second = song('s2', '七里香', '周杰伦', '七里香');
    favoritesState.favorites = [first, second, song('s3', '以父之名', '周杰伦', '叶惠美')];
    render(<FavoritesPage />);
    fireEvent.click(screen.getByRole('radio', { name: '专辑' }));

    expect(screen.queryByTestId('song-list')).toBeNull();
    const albums = Array.from(document.querySelectorAll('[data-testid="album-grid"] button')).map((el) => el.textContent);
    expect(albums.sort()).toEqual(['七里香', '叶惠美'].sort());
    expect(albumGridProps.at(-1).albums.find((album: any) => album.name === '叶惠美').artist).toBe('周杰伦');

    fireEvent.click(screen.getByText('叶惠美'));
    expect(playerState.setCurrentPlaylist).toHaveBeenCalledWith([first, favoritesState.favorites[2]], 0);
    expect(playerState.play).toHaveBeenCalledWith(first);
  });

  it('「歌手」段从收藏歌曲按 artist 聚合，复用歌手卡；点卡片按该组建队列播放', () => {
    const first = song('s1', '晴天', '周杰伦', '叶惠美');
    favoritesState.favorites = [first, song('s2', '七里香', '周杰伦', '七里香'), song('s3', '后来', '刘若英', '我等你')];
    render(<FavoritesPage />);
    fireEvent.click(screen.getByRole('radio', { name: '歌手' }));

    const artists = Array.from(document.querySelectorAll('button')).filter((el) => el.textContent === '周杰伦' || el.textContent === '刘若英');
    expect(artists.map((el) => el.textContent).sort()).toEqual(['刘若英', '周杰伦'].sort());

    fireEvent.click(artists.find((el) => el.textContent === '周杰伦') as HTMLElement);
    expect(playerState.setCurrentPlaylist).toHaveBeenCalledWith([first, favoritesState.favorites[1]], 0);
    expect(playerState.play).toHaveBeenCalledWith(first);
  });
});

describe('最近播放（#694）', () => {
  it('页头是「最近播放」，清空历史是次级危险操作不是主色 CTA', async () => {
    invoke.mockResolvedValue([]);
    render(<HistoryPage />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('最近播放');
    const danger = document.querySelector('.ui-btn--danger') as HTMLButtonElement;
    expect(danger).toBeTruthy();
    expect(danger.classList.contains('ui-btn--primary')).toBe(false);
  });

  it('清空历史先弹确认，确认后才真的调用 history:clear', async () => {
    invoke.mockResolvedValue([{ song: { id: 's1', name: '晴天', sourceType: 'netease' } }]);
    render(<HistoryPage />);
    await screen.findByRole('heading', { level: 1 });
    const danger = document.querySelector('.ui-btn--danger') as HTMLButtonElement;
    fireEvent.click(danger);
    expect(await screen.findByText('清空播放历史')).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith('history:clear');

    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '清空') as HTMLButtonElement;
    fireEvent.click(confirm);
    expect(invoke).toHaveBeenCalledWith('history:clear');
  });

  it('内容库视角恒为三段：歌曲 / 专辑 / 歌手，切到专辑后按历史歌曲聚合', async () => {
    invoke.mockResolvedValue([
      { song: song('s1', '晴天', '周杰伦', '叶惠美') },
      { song: song('s2', '七里香', '周杰伦', '七里香') },
    ]);
    render(<HistoryPage />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(segmentedValues()).toEqual(['歌曲', '专辑', '歌手']);

    fireEvent.click(screen.getByRole('radio', { name: '专辑' }));
    const albums = Array.from(document.querySelectorAll('[data-testid="album-grid"] button')).map((el) => el.textContent);
    expect(albums.sort()).toEqual(['七里香', '叶惠美'].sort());
  });
});
