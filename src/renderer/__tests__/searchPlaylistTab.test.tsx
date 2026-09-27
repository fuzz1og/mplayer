import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { DiscoverPlaylist } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import DiscoverPageV2 from '@/renderer/pages/DiscoverPageV2';
import { useSearchStore } from '@/renderer/store/searchStore';
import { usePlayerStore } from '@/renderer/store/playerStore';

/**
 * 搜索结果页「歌单」二级 tab（#415 / ADR 2026-09-27-netease-playlist-search）。
 *
 * 核心断言是**懒加载**：`cloudsearch/pc` 已是搜索页在用的腿，歌单搜索若随关键词
 * 无条件再打一发会让该腿请求数翻倍 —— 所以「有关键词但没切到歌单 tab」必须**零请求**。
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
const searchPlaylistsMock = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn(async () => ({ success: true, data: undefined })) },
}));

vi.mock('@/renderer/services/callMusicApi', () => ({
  callMusicApi: callMusicApiMock,
}));

function playlist(id: number, name: string): DiscoverPlaylist {
  return {
    id, name, coverImgUrl: '', playCount: 12345, trackCount: 30,
    creator: { nickname: '某用户' }, tags: [], description: '',
  };
}

/** 歌单搜索的实际出网调用（经 searchService → callMusicApi）。 */
const playlistCalls = () => callMusicApiMock.mock.calls.filter((c) => c[0] === 'searchPlaylists');

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPageV2 />} />
        <Route path="/discover-playlist/:id" element={<div data-testid="playlist-detail">歌单详情</div>} />
      </Routes>
    </MemoryRouter>
  );
}

/** 切到「歌单」tab 并返回该按钮（同一个 DOM 节点，count 徽标会让可访问名变化，故持有引用）。 */
async function gotoTab(name: RegExp | string) {
  const btn = screen.getByRole('button', { name });
  fireEvent.click(btn);
  return btn;
}

beforeEach(() => {
  callMusicApiMock.mockReset();
  searchPlaylistsMock.mockReset();
  searchPlaylistsMock.mockResolvedValue({ playlists: [playlist(1, '助眠精选')], total: 300, more: true });
  callMusicApiMock.mockImplementation(async (method: string, ...args: any[]) => {
    if (method === 'searchPlaylists') return searchPlaylistsMock(...args);
    if (method === 'searchArtists') return [];
    return undefined;
  });
  useSearchStore.setState({
    currentKeyword: '', preferredTab: 'songs', sourceType: 'all',
    songs: [], groups: [], loading: false, hasMore: false, error: null,
  });
  usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null, isPlaying: false, isLoading: false });
  vi.mocked(IpcClient.invoke).mockClear();
});

describe('搜索结果 歌单 tab（#415）', () => {
  it('懒加载：有关键词也不发歌单请求；切到「歌单」tab 才发一次，参数为 (netease, 关键词, 30, 0)', async () => {
    useSearchStore.setState({ currentKeyword: '助眠', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false });

    renderPage();

    // 搜索视图已渲染（二级 tab 在），歌手搜索照常发生 —— 但歌单搜索**一发都没有**
    await waitFor(() => expect(screen.getByRole('button', { name: /歌单/ })).toBeInTheDocument());
    await waitFor(() => expect(callMusicApiMock.mock.calls.some((c) => c[0] === 'searchArtists')).toBe(true));
    expect(playlistCalls()).toHaveLength(0);

    await gotoTab(/歌单/);

    await waitFor(() => expect(playlistCalls()).toHaveLength(1));
    expect(playlistCalls()[0]).toEqual(['searchPlaylists', 'netease', '助眠', 30, 0]);
    expect(await screen.findByText('助眠精选')).toBeInTheDocument();
  });

  it('同关键词来回切 tab 不重复请求（core 侧另有 6h 缓存 + 单飞）', async () => {
    useSearchStore.setState({ currentKeyword: '助眠', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false });
    renderPage();

    await gotoTab(/歌单/);
    await waitFor(() => expect(playlistCalls()).toHaveLength(1));

    await gotoTab(/单曲/);
    await gotoTab(/歌单/);
    expect(playlistCalls()).toHaveLength(1);
    expect(await screen.findByText('助眠精选')).toBeInTheDocument();
  });

  it('歌单卡片走既有歌单详情页（复用发现页同一张卡片）', async () => {
    useSearchStore.setState({ currentKeyword: '助眠', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false });
    renderPage();

    await gotoTab(/歌单/);
    fireEvent.click(await screen.findByText('助眠精选'));

    expect(await screen.findByTestId('playlist-detail')).toBeInTheDocument();
  });

  it('空结果用搜索专属空态文案（与发现页一级「歌单广场」区分）', async () => {
    searchPlaylistsMock.mockResolvedValue({ playlists: [], total: 0, more: false });
    useSearchStore.setState({ currentKeyword: 'zzz不存在', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false });
    renderPage();

    await gotoTab(/歌单/);

    expect(await screen.findByText('没有搜到歌单，去发现页看看歌单广场')).toBeInTheDocument();
    expect(screen.queryByText('暂无歌单')).toBeNull();
  });

  it('失败显示错误态（不再静默空数组），重试会重新请求', async () => {
    searchPlaylistsMock.mockRejectedValueOnce(new Error('cloudsearch code=405 操作频繁，请稍候再试'));
    useSearchStore.setState({ currentKeyword: '助眠', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false });
    renderPage();

    await gotoTab(/歌单/);
    expect(await screen.findByText(/code=405/)).toBeInTheDocument();
    expect(playlistCalls()).toHaveLength(1);

    // 重试走 force：同关键词闸门被绕过 → 真的再发一发
    searchPlaylistsMock.mockResolvedValue({ playlists: [playlist(2, '重试成功')], total: 1, more: false });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(playlistCalls()).toHaveLength(2));
    expect(await screen.findByText('重试成功')).toBeInTheDocument();
  });

  it('换关键词后「歌单」tab 未加载过，切过去用新关键词请求', async () => {
    useSearchStore.setState({ currentKeyword: '助眠', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false });
    renderPage();

    await gotoTab(/歌单/);
    await waitFor(() => expect(playlistCalls()).toHaveLength(1));

    // 新关键词：换关键词会先把二级 tab 拨回「单曲」（既有行为）
    useSearchStore.setState({ currentKeyword: '写作业' });
    await waitFor(() => expect(screen.getByRole('button', { name: /单曲/ })).toHaveAttribute('aria-pressed', 'true'));
    // 旧结果已作废
    expect(screen.queryByText('助眠精选')).toBeNull();

    await gotoTab(/歌单/);
    await waitFor(() => expect(playlistCalls()).toHaveLength(2));
    expect(playlistCalls()[1][2]).toBe('写作业');
  });
});
