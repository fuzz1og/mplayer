import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 详情页过滤接线（#694 回归）：工具条的 N / M 首来自 useDetailSelection.visibleSongs，
 * 列表必须消费同一个集合，否则计数变了而列表不动——用户看到的就是「过滤不生效」。
 */
const callMusicApi = vi.fn();
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: (...a: any[]) => callMusicApi(...a) }));
vi.mock('@/renderer/hooks/useDownload', () => ({
  useDownload: () => ({ download: vi.fn(), downloadBatch: vi.fn() }),
}));
vi.mock('@/renderer/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => {} }));
vi.mock('@/renderer/store/playerStore', () => ({
  usePlayerStore: (s: any) => s({ currentSong: null, isPlaying: false, play: vi.fn(), setCurrentPlaylist: vi.fn() }),
}));
vi.mock('@/renderer/store/favoriteStore', () => ({
  useFavoriteStore: (s: any) => s({ favoriteIds: [], toggleFavorite: vi.fn() }),
}));
vi.mock('@/renderer/services/playableVersionAdapter', () => ({ resolvePlayableVersionForDesktop: async (s: any) => s }));
vi.mock('@/renderer/services/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AlbumDetailPage from '@/renderer/pages/AlbumDetailPage';

const rendererRoot = join(dirname(fileURLToPath(String(import.meta.url))), '..');
const read = (rel: string) => readFileSync(join(rendererRoot, rel), 'utf8');

const SONGS = [
  { id: 's1', name: '晴天', artist: '周杰伦', album: '叶惠美', url: '', cover: '', lrc: '', duration: 269, sourceType: 'netease' },
  { id: 's2', name: '七里香', artist: '周杰伦', album: '七里香', url: '', cover: '', lrc: '', duration: 299, sourceType: 'netease' },
  { id: 's3', name: '左边', artist: '杨丞琳', album: '', url: '', cover: '', lrc: '', duration: 274, sourceType: 'netease' },
] as any[];

beforeEach(() => {
  callMusicApi.mockReset();
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('详情页过滤接线（#694）', () => {
  it('五个详情页的列表都消费 visibleSongs，而不是未过滤的全量', () => {
    for (const [file, listProp] of [
      ['pages/AlbumDetailPage.tsx', 'songs'],
      ['pages/ArtistDetailPage.tsx', 'songs'],
      ['pages/HotlistDetailPage.tsx', 'songs'],
      ['pages/DiscoverPlaylistDetailPage.tsx', 'songs'],
      ['pages/PlaylistDetailPage.tsx', 'items'],
    ] as const) {
      const src = read(file);
      expect(src, file).toContain(`${listProp}={visibleSongs}`);
      // 计数与列表必须同源：出现「全量」喂列表就是回退
      expect(src, file).not.toMatch(/<SongList[\s\S]{0,200}?\n\s*(songs|items)=\{(songs|hotlist)\}/);
    }
  });

  it('专辑详情：过滤框输入后行数跟着计数一起收敛', async () => {
    callMusicApi.mockResolvedValue({
      album: { id: 'a1', name: '叶惠美', artist: '周杰伦', picUrl: '', publishTime: '', sourceType: 'netease' },
      songs: SONGS,
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/album/a1']}>
        <Routes><Route path="/album/:id" element={<AlbumDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(3));

    const input = container.querySelector('input[aria-label="按歌名或歌手过滤"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '左边' } });

    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(1));
    expect(container.textContent).toContain('1 / 3 首');
    expect(container.textContent).toContain('左边');

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(3));
  });

  it('过滤态进入选择模式：全选只作用于可见项，清空关键词后选择仍在', async () => {
    callMusicApi.mockResolvedValue({
      album: { id: 'a1', name: '叶惠美', artist: '周杰伦', picUrl: '', publishTime: '', sourceType: 'netease' },
      songs: SONGS,
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/album/a1']}>
        <Routes><Route path="/album/:id" element={<AlbumDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(3));

    const input = container.querySelector('input[aria-label="按歌名或歌手过滤"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '周杰伦' } });
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(2));

    fireEvent.click(container.querySelector('.detail-toolbar__toggle') as HTMLElement);
    await waitFor(() => expect(container.querySelector('.detail-toolbar__toggle')?.textContent?.trim()).toBe('完成'));

    fireEvent.click(container.querySelector('input[aria-label="全选可见歌曲"]') as HTMLElement);
    await waitFor(() => expect(container.textContent).toContain('已选择 2 项'));

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(3));
  });
});
