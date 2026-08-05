import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { ipcMusicApi } from '@/renderer/services/IpcMusicApi';
import SongList from '@/renderer/components/SongList';
import FavoritesPage from '@/renderer/pages/FavoritesPage';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useSearchStore } from '@/renderer/store/searchStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';

const audioPlayerMock = vi.hoisted(() => {
  const player = {
    getVolume: vi.fn(() => 80),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getState: vi.fn(() => 'idle'),
    getCurrentSong: vi.fn(() => null),
    isPlaying: vi.fn(() => false),
    isPaused: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    cancelLoad: vi.fn(),
    load: vi.fn(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    destroy: vi.fn(),
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
    getAudioUrl: vi.fn(async () => 'https://resolved.example.com/a.mp3'),
    getSodaPlayableUrl: vi.fn(async () => ''),
  },
}));

function song(id: string, name = '晴天', sourceType: Song['sourceType'] = 'netease'): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType, url: `https://audio.example.com/${id}.mp3`, cover: '', lrc: '',
  };
}

const invokeMock = vi.mocked(IpcClient.invoke);
const searchSongsMock = vi.mocked(ipcMusicApi.searchSongs);

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockImplementation(async (channel: string) => {
    if (channel === 'musicApi:probeAudio') return [{ songId: '1', tag: 'valid' }];
    return { success: true, data: undefined };
  });
  searchSongsMock.mockReset();
  usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null, isPlaying: false, isLoading: false });
  useSearchStore.setState({ currentKeyword: '', preferredTab: 'songs' });
  useFavoriteStore.setState({ favorites: [], favoriteIds: [], loading: false, error: null });
});

describe('SongList 单曲换源流程', () => {
  it('user swaps a song via the more menu and the row, queue and onSwap all reflect it', async () => {
    const s1 = song('netease:1');
    const onSwap = vi.fn();
    // 模拟用户已把该列表加入播放队列
    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: null });
    searchSongsMock.mockImplementation(async (kw: string, _page: number, source: string) => {
      if (source !== 'qq') return [];
      return [{ ...song('1', '晴天', 'qq'), url: 'https://audio.qq.com/full.mp3' }];
    });

    render(
      <MemoryRouter>
        <SongList songs={[s1]} onSwap={onSwap} onPlay={vi.fn()} showHeader={false} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '更多操作: 晴天' }));
    fireEvent.click(screen.getByRole('button', { name: '换源完整版' }));
    fireEvent.click(screen.getByRole('button', { name: 'QQ音乐' }));
    fireEvent.click(await screen.findByRole('button', { name: '晴天' }));

    await waitFor(() => {
      expect(onSwap).toHaveBeenCalledTimes(1);
    });

    const [original, swapped] = onSwap.mock.calls[0];
    expect(original.id).toBe('netease:1');
    expect(swapped.id).toBe('qq:1');
    expect(swapped.sourceType).toBe('qq');
    expect(usePlayerStore.getState().currentPlaylist[0].id).toBe('qq:1');
    expect(screen.getAllByText('QQ').length).toBeGreaterThan(0);
  });

  it('换源收藏页歌曲：行更新、队列替换、favorite:replaceSong 被调用', async () => {
    const s1 = song('netease:1');
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'favorite:getAll') return [s1];
      if (channel === 'cache:getUrl') return null;
      if (channel === 'musicApi:searchSongs') return [];
      if (channel === 'musicApi:probeAudio') return [{ songId: '1', tag: 'valid' }];
      return { success: true, data: undefined };
    });
    useFavoriteStore.setState({ favorites: [s1], favoriteIds: ['netease:1'], loading: false, error: null });
    // 用户已把该列表加入播放队列
    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: null });
    searchSongsMock.mockImplementation(async (kw: string, _page: number, source: string) => {
      if (source !== 'qq') return [];
      return [{ ...song('1', '晴天', 'qq'), url: 'https://audio.qq.com/full.mp3' }];
    });

    render(
      <MemoryRouter>
        <FavoritesPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: '更多操作: 晴天' }));
    fireEvent.click(screen.getByRole('button', { name: '换源完整版' }));
    fireEvent.click(screen.getByRole('button', { name: 'QQ音乐' }));
    fireEvent.click(await screen.findByRole('button', { name: '晴天' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'favorite:replaceSong',
        'netease:1',
        expect.objectContaining({ id: 'qq:1', sourceType: 'qq' })
      );
    });

    const favorites = useFavoriteStore.getState();
    expect(favorites.favorites.map(f => f.id)).toEqual(['qq:1']);
    expect(favorites.favoriteIds).toEqual(['qq:1']);
    expect(usePlayerStore.getState().currentPlaylist[0].id).toBe('qq:1');
  });

  it('user views an artist from the more menu and lands on the artists search tab', async () => {
    render(
      <MemoryRouter>
        <SongList songs={[song('netease:1')]} onPlay={vi.fn()} showHeader={false} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '更多操作: 晴天' }));
    fireEvent.click(screen.getByRole('button', { name: '查看歌手' }));

    await waitFor(() => {
      expect(useSearchStore.getState().preferredTab).toBe('artists');
      expect(useSearchStore.getState().currentKeyword).toBe('周杰伦');
    });
  });

  it('stale probe from a previous source does not overwrite the current candidates', async () => {
    const s1 = song('netease:1');
    let resolveOldProbe!: (value: { songId: string; tag: 'valid' }[]) => void;
    const oldProbe = new Promise<{ songId: string; tag: 'valid' }[]>((resolve) => {
      resolveOldProbe = resolve;
    });
    invokeMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'musicApi:probeAudio') {
        const songs = args[0] as Song[];
        const firstId = songs[0]?.id;
        if (firstId === '1') return oldProbe; // QQ 候选探测挂起
        return [{ songId: firstId, tag: 'valid' }];
      }
      return { success: true, data: undefined };
    });
    searchSongsMock.mockImplementation(async (kw: string, _page: number, source: string) => {
      if (source === 'qq') return [{ ...song('1', '晴天', 'qq'), url: 'https://audio.qq.com/full.mp3' }];
      if (source === 'kugou') return [{ ...song('k2', '晴天 (Live)', 'kugou'), url: 'https://audio.kugou.com/live.mp3' }];
      return [];
    });

    render(
      <MemoryRouter>
        <SongList songs={[s1]} onPlay={vi.fn()} showHeader={false} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '更多操作: 晴天' }));
    fireEvent.click(screen.getByRole('button', { name: '换源完整版' }));
    fireEvent.click(screen.getByRole('button', { name: 'QQ音乐' }));
    expect(await screen.findByRole('button', { name: '晴天' })).toBeInTheDocument();

    // 探测未返回时切到酷狗
    fireEvent.click(screen.getByRole('button', { name: '返回选择其他音乐源' }));
    fireEvent.click(screen.getByRole('button', { name: '酷狗' }));
    expect(await screen.findByRole('button', { name: '晴天 (Live)' })).toBeInTheDocument();

    // 旧源的慢探测姗姗来迟：不应覆盖酷狗候选
    resolveOldProbe([{ songId: '1', tag: 'valid' }]);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '晴天' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: '晴天 (Live)' })).toBeInTheDocument();
  });
});
