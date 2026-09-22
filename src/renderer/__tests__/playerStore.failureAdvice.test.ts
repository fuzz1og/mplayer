import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';

/**
 * 播放失败归因接线（#357）：解析链穷尽时，桌面经 IPC 取回 core 的可操作文案，
 * 而不是统一报「可能为 VIP/无版权」。归因逻辑本身在 core 单测（tier3Api.test.ts）。
 */

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

const ADVICE_MESSAGE = '适用「网易云」的 1 个订阅源都试过了，未命中或超时。源可能临时失效/限流，可稍后重试或更换订阅';

vi.mock('../services/callMusicApi', () => ({
  callMusicApi: vi.fn(async (method: string) => {
    switch (method) {
      case 'resolvePlayableSongRouted':
        return { url: '', nonFull: false };
      case 'searchSongsRouted':
        return [];
      case 'explainPlaybackFailure':
        return { kind: 'sources-missed', declared: 1, usable: 1, skipped: 0, message: '适用「网易云」的 1 个订阅源都试过了，未命中或超时。源可能临时失效/限流，可稍后重试或更换订阅' };
      default:
        return undefined;
    }
  }),
}));

import { callMusicApi } from '../services/callMusicApi';
import { usePlayerStore } from '../store/playerStore';

function song(id: string): Song {
  return {
    id, name: '晴天', artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: '', cover: '', lrc: '',
  };
}

beforeEach(() => {
  vi.mocked(callMusicApi).mockClear();
  usePlayerStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    currentPlaylist: [],
    currentPlaylistIndex: -1,
    error: null,
  });
});

describe('解析链穷尽 → 用 core 归因文案（#357）', () => {
  it('失败态 error 携带归因文案，且确实问过 core', async () => {
    const s = song('netease:1');
    usePlayerStore.setState({ currentPlaylist: [s], currentPlaylistIndex: 0, currentSong: s });

    await usePlayerStore.getState().play(s);

    expect(callMusicApi).toHaveBeenCalledWith('explainPlaybackFailure', s);
    expect(usePlayerStore.getState().error).toBe(ADVICE_MESSAGE);
  });
});
