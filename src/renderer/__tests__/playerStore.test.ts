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

// IPC 是系统边界：给播放器返回一个可用的解析 URL，让续播流程真正走到音频加载
vi.mock('../services/IpcMusicApi', () => ({
  ipcMusicApi: {
    getAudioUrl: vi.fn(async () => 'https://resolved.example.com/a.mp3'),
    getSodaPlayableUrl: vi.fn(async () => ''),
    searchSongs: vi.fn(async () => []),
  },
}));

import { usePlayerStore } from '../store/playerStore';

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
  audioPlayerMock.player.load.mockClear();
  audioPlayerMock.player.play.mockClear();
  audioPlayerMock.player.cancelLoad.mockClear();
});

describe('replaceQueueSong（换源后队列原位替换）', () => {
  it('replaces a non-current queue entry without touching playback', async () => {
    const s1 = song('netease:1', '晴天');
    const s2 = song('netease:2', '稻香');
    const s3 = song('netease:3', '七里香');
    const swapped = { ...s1, id: 'qq:1', sourceType: 'qq' as const, url: 'https://audio.qq.com/1.mp3' };
    usePlayerStore.setState({ currentPlaylist: [s1, s2, s3], currentPlaylistIndex: 1, currentSong: s2 });

    await usePlayerStore.getState().replaceQueueSong(s1.id, swapped);

    const state = usePlayerStore.getState();
    expect(state.currentPlaylist.map(s => s.id)).toEqual(['qq:1', 'netease:2', 'netease:3']);
    expect(state.currentSong?.id).toBe('netease:2');
    expect(state.currentPlaylistIndex).toBe(1);
    expect(audioPlayerMock.player.load).not.toHaveBeenCalled();
  });

  it('replaces the playing song and continues with the new version', async () => {
    const s1 = song('netease:1', '晴天');
    const swapped = { ...s1, id: 'qq:1', sourceType: 'qq' as const, url: 'https://audio.qq.com/1.mp3' };
    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1 });

    await usePlayerStore.getState().replaceQueueSong(s1.id, swapped);

    const state = usePlayerStore.getState();
    expect(state.currentPlaylist[0].id).toBe('qq:1');
    expect(state.currentSong?.id).toBe('qq:1');
    expect(audioPlayerMock.player.load).toHaveBeenCalled();
    expect(audioPlayerMock.player.play).toHaveBeenCalled();
  });

  it('continues playback when the song is playing but not in the queue', async () => {
    const s1 = song('netease:1', '晴天');
    const swapped = { ...s1, id: 'qq:1', sourceType: 'qq' as const, url: 'https://audio.qq.com/1.mp3' };
    usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: s1 });

    await usePlayerStore.getState().replaceQueueSong(s1.id, swapped);

    expect(usePlayerStore.getState().currentSong?.id).toBe('qq:1');
    expect(audioPlayerMock.player.load).toHaveBeenCalled();
  });
});
