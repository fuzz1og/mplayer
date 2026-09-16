import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TOPLIST_SOURCE_IDS } from '@mplayer/core';
import type { Song, ToplistGroup, ToplistSourceKey } from '@mplayer/core';
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

const callMusicApiMock = vi.hoisted(() => vi.fn());

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

function song(sourceType: Song['sourceType'], id: string, name: string, rankMeta?: Song['rankMeta']): Song {
  return { id, name, artist: '歌手', album: '', duration: 200, sourceType, url: '', cover: '', lrc: '', ...(rankMeta ? { rankMeta } : {}) };
}

/** 单源 getToplists 结果：热歌/新歌各一组，id 用 core 契约值（消费方按 id 取组）。 */
function groupsFor(source: ToplistSourceKey): ToplistGroup[] {
  const ids = TOPLIST_SOURCE_IDS[source];
  const extra = source === 'qq' ? ({ prevRank: 5, weeks: 3 } as const) : undefined;
  return [
    { id: `${source}:${ids.hot}`, name: '热歌榜', songs: [song(source, `${source}-h`, `${source} 热歌`, extra)] },
    { id: `${source}:${ids.new}`, name: '新歌榜', songs: [song(source, `${source}-n`, `${source} 新歌`)] },
  ];
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPageV2 />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('发现页 V2 排行榜（#332 单元榜 + 源切换）', () => {
  beforeEach(() => {
    sessionStorage.clear();
    callMusicApiMock.mockReset();
    callMusicApiMock.mockImplementation(async (method: string, source: ToplistSourceKey) =>
      method === 'getToplists' ? groupsFor(source) : undefined
    );
    useSearchStore.setState({ currentKeyword: '', preferredTab: 'songs', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false, error: null });
    usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null, isPlaying: false, isLoading: false });
    vi.mocked(IpcClient.invoke).mockClear();
  });

  it('切源取该源榜单；切回未过期缓存的源不串榜、也不重复请求', async () => {
    renderPage();

    // 初始源 = 网易云：标题 = 源名 · ToplistGroup.name
    expect(await screen.findByText('netease 热歌')).toBeInTheDocument();
    expect(screen.getByText('netease 新歌')).toBeInTheDocument();
    expect(screen.getByText('网易云 · 热歌榜')).toBeInTheDocument();
    expect(screen.getByText('网易云 · 新歌榜')).toBeInTheDocument();

    // 切 QQ：换成 QQ 榜单 + 可选列（上期名次/在榜周数）渲染
    fireEvent.click(screen.getByRole('button', { name: 'QQ' }));
    expect(await screen.findByText('qq 热歌')).toBeInTheDocument();
    expect(screen.queryByText('netease 热歌')).toBeNull();
    expect(screen.getByText('QQ · 热歌榜')).toBeInTheDocument();
    expect(screen.getByText('↑4')).toBeInTheDocument(); // prevRank 5 - rank 1
    expect(screen.getByText(/在榜 3 周/)).toBeInTheDocument();

    // 切回网易云：命中未过期缓存也必须把该源榜单铺回状态（曾出现沿用 QQ 曲目）
    fireEvent.click(screen.getByRole('button', { name: '网易云' }));
    expect(await screen.findByText('netease 热歌')).toBeInTheDocument();
    expect(screen.queryByText('qq 热歌')).toBeNull();
    expect(screen.getByText('网易云 · 热歌榜')).toBeInTheDocument();

    // 缓存命中不重复请求：netease 首次 + qq 切换 = 2 次
    const calls = callMusicApiMock.mock.calls.filter((c) => c[0] === 'getToplists');
    expect(calls).toHaveLength(2);
  });
});
