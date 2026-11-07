import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DjRadio } from '@mplayer/core';
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

const callMusicApiMock = vi.hoisted(() => vi.fn());
const searchDjRadiosMock = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));
vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn(async () => ({ success: true, data: undefined })) },
}));
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: callMusicApiMock }));

function radio(): DjRadio {
  return {
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
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPageV2 />} />
        <Route path="/djradio/:id" element={<div data-testid="djradio-detail">电台详情</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const radioCalls = () => callMusicApiMock.mock.calls.filter((call) => call[0] === 'searchDjRadios');

beforeEach(() => {
  callMusicApiMock.mockReset();
  searchDjRadiosMock.mockReset();
  searchDjRadiosMock.mockResolvedValue([radio()]);
  callMusicApiMock.mockImplementation(async (method: string, ...args: unknown[]) => {
    if (method === 'searchDjRadios') return searchDjRadiosMock(...args);
    if (method === 'searchArtists') return [];
    return undefined;
  });
  useSearchStore.setState({
    currentKeyword: '邪热搜索', preferredTab: 'songs', sourceType: 'all',
    songs: [], groups: [], loading: false, hasMore: false, error: null,
  });
  usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null, isPlaying: false });
});

describe('搜索结果 电台 tab（#742）', () => {
  it('懒加载；切到电台 tab 才搜，卡片进入电台详情', async () => {
    renderPage();

    const tab = await screen.findByRole('button', { name: /电台/ });
    expect(radioCalls()).toHaveLength(0);

    fireEvent.click(tab);
    await waitFor(() => expect(radioCalls()).toHaveLength(1));
    expect(radioCalls()[0]).toEqual(['searchDjRadios', 'netease', '邪热搜索']);
    expect(await screen.findByText('网易云电台搜索最多展示 10 个结果')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'AI 陶喆' }));
    expect(await screen.findByTestId('djradio-detail')).toBeInTheDocument();
  });

  it('限流失败显示错误，重试可恢复', async () => {
    searchDjRadiosMock
      .mockRejectedValueOnce(new Error('cloudsearch code=406 操作频繁，请稍后重试'))
      .mockResolvedValueOnce([radio()]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /电台/ }));
    expect(await screen.findByText(/code=406/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(radioCalls()).toHaveLength(2));
    expect(await screen.findByRole('button', { name: 'AI 陶喆' })).toBeInTheDocument();
  });
});
