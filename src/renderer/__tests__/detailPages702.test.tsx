import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** 歌手详情 + 榜单详情（#702/#694）：与歌单 / 专辑同一套详情页模板。 */

const callMusicApi = vi.fn();
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: (...a: any[]) => callMusicApi(...a) }));
const downloadBatch = vi.fn();
vi.mock('@/renderer/hooks/useDownload', () => ({
  useDownload: () => ({ download: vi.fn(), downloadBatch }),
}));
vi.mock('@/renderer/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => {} }));
vi.mock('@/renderer/services/playlistWriteAdapter', () => ({
  createDesktopPlaylistWriter: () => ({ createAndAdd: vi.fn(async () => ({ ok: true, added: 0 })) }),
}));
const playerState = { currentSong: null as any, isPlaying: false, play: vi.fn(), setCurrentPlaylist: vi.fn() };
vi.mock('@/renderer/store/playerStore', () => ({ usePlayerStore: (s: any) => s(playerState) }));
const favState = { favoriteIds: [] as string[], toggleFavorite: vi.fn() };
vi.mock('@/renderer/store/favoriteStore', () => ({ useFavoriteStore: (s: any) => s(favState) }));
vi.mock('@/renderer/services/searchService', () => ({ searchService: { search: vi.fn() } }));
vi.mock('@/renderer/services/playableVersionAdapter', () => ({ resolvePlayableVersionForDesktop: async (s: any) => s }));
vi.mock('@/renderer/services/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ArtistDetailPage from '@/renderer/pages/ArtistDetailPage';
import HotlistDetailPage from '@/renderer/pages/HotlistDetailPage';

const SONGS = [
  { id: 's1', name: '晴天', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 269, sourceType: 'netease' },
  { id: 's2', name: '七里香', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 299, sourceType: 'netease' },
] as any[];

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
      <Routes><Route path={pattern} element={element} /></Routes>
    </MemoryRouter>,
  );
}

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

describe('歌手详情（#702）', () => {
  it('唯一 h1、唯一主色 CTA、圆形媒体，三段用 Segmented 落在 hero 内', async () => {
    callMusicApi.mockResolvedValue({ songs: SONGS, total: 2 });
    const { container } = renderAt('/artist/1', '/artist/:id', <ArtistDetailPage />);
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(2));
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expectDetailTemplate(container);
    expect(screen.queryByText('返回')).toBeNull();

    // 圆形媒体：hero 内的歌手媒体与方形容器区分开
    const media = container.querySelector('.ui-page-hero__media .detail-page__cover');
    expect(media?.classList.contains('detail-page__cover--round')).toBe(true);

    // 三段是 hero 内的分段控件，不是压在列表上的第二道横条
    const hero = container.querySelector('.ui-page-hero') as HTMLElement;
    const segmented = hero.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(segmented).toBeTruthy();
    expect(segmented.getAttribute('aria-label')).toBe('歌手内容视图');
    expect(Array.from(segmented.querySelectorAll('[role="radio"]')).map((el) => el.textContent))
      .toEqual(['热门歌曲', '最新歌曲', '专辑']);
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1);
  });
});

describe('热榜详情（#702）', () => {
  it('唯一 h1、唯一主色 CTA、无局部返回，保存全部是次级按钮', async () => {
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getToplists') return [{ id: 'netease:3778678', name: '网易云音乐热歌榜', songs: SONGS }];
      if (method === 'getToplistDetail') return { id: 'hot', name: '网易云音乐热歌榜', coverImgUrl: '', playCount: 0, description: '', updateTime: null };
      return undefined;
    });
    const { container } = renderAt('/hotlist/netease', '/hotlist/:type', <HotlistDetailPage />);
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(2));
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(container.querySelectorAll('.ui-btn--primary').length).toBe(1);

    const primary = container.querySelector('.ui-btn--primary') as HTMLElement;
    expect(primary.textContent).toContain('播放全部');
    // 「保存全部到新歌单」保留能力，但不是主色 CTA
    const saveAll = Array.from(container.querySelectorAll('.ui-page-hero__actions .ui-btn'))
      .find((button) => button.textContent?.includes('保存全部到新歌单')) as HTMLElement;
    expect(saveAll).toBeTruthy();
    expect(saveAll.classList.contains('ui-btn--primary')).toBe(false);
    expect(container.querySelectorAll('thead, .song-list__head').length).toBe(0);
  });
});
