import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';

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

vi.mock('../services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));

vi.mock('../services/callMusicApi', () => ({
  callMusicApi: vi.fn(),
}));

import { callMusicApi } from '../services/callMusicApi';
import { usePlayerStore } from '../store/playerStore';
import { useSearchStore } from '../store/searchStore';

function song(id: string, name = '晴天'): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: `https://audio.example.com/${id}.mp3`, cover: '', lrc: '',
  };
}

beforeEach(() => {
  usePlayerStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    position: 0,
    duration: 0,
    currentPlaylist: [],
    currentPlaylistIndex: -1,
    error: null,
  });
  useSearchStore.getState().reset();
  vi.mocked(callMusicApi).mockReset();
  vi.mocked(callMusicApi).mockImplementation(async (method: string) => {
    switch (method) {
      case 'resolvePlayableSongRouted':
        return { url: 'https://resolved.example.com/a.mp3', nonFull: false };
      case 'getSodaPlayableUrl':
        return '';
      case 'searchSongsRouted':
        return [];
      default:
        return undefined;
    }
  });
});

describe('playerStore 播放后回写可播性徽标（不再预显）', () => {
  it('解析为试听版（nonFull=true）→ 列表回写 preview 徽标', async () => {
    const s = song('netease:1');
    useSearchStore.getState().setSongs([s]);
    vi.mocked(callMusicApi).mockImplementation(async (method: string) => {
      if (method === 'resolvePlayableSongRouted') {
        return { url: 'https://cdn.example.com/trial.mp3', nonFull: true };
      }
      return undefined;
    });

    await usePlayerStore.getState().play(s);

    const updated = useSearchStore.getState().songs.find((x) => x.id === s.id);
    expect(updated?.audioTag).toBe('preview');
  });

  it('播放失败（拿不到 URL）→ 列表回写 invalid 徽标（不可播）', async () => {
    const s = song('netease:1');
    useSearchStore.getState().setSongs([s]);
    vi.mocked(callMusicApi).mockImplementation(async (method: string) => {
      if (method === 'resolvePlayableSongRouted') {
        return { url: '', nonFull: false };
      }
      if (method === 'searchSongsRouted') return [];
      return undefined;
    });

    await usePlayerStore.getState().play(s);

    const updated = useSearchStore.getState().songs.find((x) => x.id === s.id);
    expect(updated?.audioTag).toBe('invalid');
  });

  it('完整版播放成功 → 回写 valid，清掉旧失败徽标', async () => {
    const s = song('netease:1');
    useSearchStore.getState().setSongs([{ ...s, audioTag: 'invalid' }]);

    await usePlayerStore.getState().play(s);

    const updated = useSearchStore.getState().songs.find((x) => x.id === s.id);
    expect(updated?.audioTag).toBe('valid');
  });
});
