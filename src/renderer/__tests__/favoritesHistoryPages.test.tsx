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

beforeEach(() => {
  songListProps.length = 0;
  invoke.mockReset();
});

describe('我喜欢的音乐（#701）', () => {
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
});

describe('最近播放（#701）', () => {
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
});
