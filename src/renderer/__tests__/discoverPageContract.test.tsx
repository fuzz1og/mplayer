import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Song, SongGroup } from '@mplayer/core';
import DiscoverPageV2 from '@/renderer/pages/DiscoverPageV2';
import { useSearchStore } from '@/renderer/store/searchStore';
import { usePlayerStore } from '@/renderer/store/playerStore';

/**
 * #705 发现页：页头命名、发现内容来源与搜索来源互不影响、分组/单源点播队列。
 */

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

const callMusicApiMock = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));

vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: callMusicApiMock }));

function song(id: string, name = '歌曲 ' + id): Song {
  return {
    id, name, artist: '歌手', album: '', duration: 240,
    sourceType: 'netease', url: 'https://audio.example.com/' + id + '.mp3', cover: '', lrc: '',
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPageV2 />} />
      </Routes>
    </MemoryRouter>,
  );
}

const contentSourceGroup = () => within(screen.getByRole('group', { name: '发现内容来源' }));

beforeEach(() => {
  sessionStorage.clear();
  callMusicApiMock.mockReset();
  callMusicApiMock.mockImplementation(async () => undefined);
  useSearchStore.setState({
    currentKeyword: '', preferredTab: 'songs', sourceType: 'all', songs: [], groups: [],
    expandedKeys: [], loading: false, loadingMore: false, hasMore: false, error: null,
  });
  usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null, isPlaying: false });
});

describe('发现页页头与来源作用域（#705）', () => {
  it('h1 与侧栏统一为「发现」，「今天听什么」只做 lead', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('发现');
    expect(screen.getByText('今天听什么')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '今天听什么' })).toBeNull();
    expect(screen.getByRole('group', { name: '内容分类' })).toBeInTheDocument();
  });

  it('发现内容来源与搜索来源是两个独立 state：互相点选不串', async () => {
    useSearchStore.setState({ sourceType: 'kugou' });
    renderPage();

    // 发现内容来源默认仍是网易云，不受搜索来源影响
    const sourceButtons = contentSourceGroup().getAllByRole('button');
    expect(sourceButtons.map((b) => b.textContent)).toEqual(['网易云', 'QQ音乐', '酷狗']);
    expect(sourceButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(useSearchStore.getState().sourceType).toBe('kugou');

    // 点发现内容来源 → 只切换内容源，不改搜索来源
    fireEvent.click(contentSourceGroup().getByRole('button', { name: 'QQ音乐' }));
    await waitFor(() => expect(callMusicApiMock.mock.calls.some((c) => c[0] === 'getToplists' && c[1] === 'qq')).toBe(true));
    expect(useSearchStore.getState().sourceType).toBe('kugou');

    // 改搜索来源 → 发现内容来源选中项不变
    useSearchStore.setState({ sourceType: 'qq' });
    await waitFor(() => expect(contentSourceGroup().getByRole('button', { name: 'QQ音乐' })).toHaveAttribute('aria-pressed', 'true'));
    expect(contentSourceGroup().getByRole('button', { name: '网易云' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('全源搜索：分组点播队列 = 该组歌曲，index = 组内下标（D1）', async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ play: playSpy });
    const groups: SongGroup[] = [
      { key: 'g1', name: '组一', artist: '', songs: [song('1'), song('2')] },
      { key: 'g2', name: '组二', artist: '', songs: [song('3')] },
    ];
    useSearchStore.setState({
      currentKeyword: '晴天', sourceType: 'all', songs: [], groups, expandedKeys: ['g1'],
      loading: false, hasMore: false, error: null,
    });
    const { container } = renderPage();

    const row = Array.from(container.querySelectorAll('.song-row')).find((el) => el.textContent?.includes('歌曲 2')) as HTMLElement;
    expect(row).toBeTruthy();
    fireEvent.click(row.querySelector('.song-row__cover-play') as HTMLElement);

    const state = usePlayerStore.getState();
    expect(state.currentPlaylist.map((s) => s.id)).toEqual(['1', '2']);
    expect(state.currentPlaylistIndex).toBe(1);
    expect(playSpy).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });

  it('全源搜索默认扁平：每组只渲染第一版，结果区顶部只留「N 首 · 已按相关度排序」', () => {
    const groups: SongGroup[] = [
      { key: 'g1', name: '组一', artist: '', songs: [song('1'), song('2'), song('3')] },
      { key: 'g2', name: '组二', artist: '', songs: [song('4')] },
    ];
    useSearchStore.setState({
      currentKeyword: '晴天', sourceType: 'all', songs: [], groups, expandedKeys: [],
      loading: false, hasMore: false, error: null,
    });
    const { container } = renderPage();

    // 每组一行（2 组 = 2 行），其余版本默认不渲染，组标题行与「全部展开」都已下线
    expect(container.querySelectorAll('.grouped .song-row')).toHaveLength(2);
    expect(screen.getByText('2 首 · 已按相关度排序')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '全部展开' })).toBeNull();
    // 只有多版本组（g1）带「N 个版本」入口
    expect(screen.getAllByRole('button', { name: /个版本/ })).toHaveLength(1);
  });

  it('单源搜索：队列 = 该源搜索结果，index = 结果内下标', async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ play: playSpy });
    useSearchStore.setState({
      currentKeyword: '晴天', sourceType: 'qq', songs: [song('a'), song('b'), song('c')],
      groups: [], expandedKeys: [], loading: false, hasMore: false, error: null,
    });
    const { container } = renderPage();

    const row = Array.from(container.querySelectorAll('.song-row')).find((el) => el.textContent?.includes('歌曲 b')) as HTMLElement;
    expect(row).toBeTruthy();
    fireEvent.click(row.querySelector('.song-row__cover-play') as HTMLElement);

    const state = usePlayerStore.getState();
    expect(state.currentPlaylist.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(state.currentPlaylistIndex).toBe(1);
    expect(playSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });
});
