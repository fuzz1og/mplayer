import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from 'expo-audio';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { cleanup, playSong } from '../services/audioPlayer';

type StatusListener = (status: AudioStatus) => void;

interface MockPlayer {
  id: number;
  playing: boolean;
  listeners: Set<StatusListener>;
  addListener: (event: 'playbackStatusUpdate', listener: StatusListener) => { remove(): void };
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  setActiveForLockScreen: () => void;
  remove: () => void;
}

const audioMocks = vi.hoisted(() => {
  const players: MockPlayer[] = [];
  const createAudioPlayer = vi.fn((): MockPlayer => {
    const player: MockPlayer = {
      id: players.length + 1,
      playing: false,
      listeners: new Set<StatusListener>(),
      addListener: (_event, listener) => {
        player.listeners.add(listener);
        return {
          remove: () => {
            player.listeners.delete(listener);
          },
        };
      },
      play: () => {
        player.playing = true;
      },
      pause: () => {
        player.playing = false;
      },
      seekTo: async () => {},
      setActiveForLockScreen: () => {},
      remove: () => {},
    };
    players.push(player);
    return player;
  });
  return { players, createAudioPlayer };
});

vi.mock('expo-audio', () => ({
  createAudioPlayer: audioMocks.createAudioPlayer,
  setAudioModeAsync: vi.fn(async () => {}),
}));

vi.mock('@mplayer/core', () => ({
  musicApi: {},
  resolvePlayableUrl: vi.fn(async (song: Song) => `https://example.com/${song.id}.mp3`),
}));

vi.mock('../services/notificationService', () => ({
  updateNotification: vi.fn(async () => {}),
  clearNotification: vi.fn(async () => {}),
}));

function status(overrides: Partial<AudioStatus> = {}): AudioStatus {
  return {
    id: 'player',
    currentTime: 0,
    playbackState: 'ready',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    mute: false,
    duration: 0,
    playing: false,
    loop: false,
    didJustFinish: false,
    isBuffering: false,
    isLoaded: true,
    playbackRate: 1,
    shouldCorrectPitch: false,
    isLive: false,
    currentOffsetFromLive: null,
    error: null,
    ...overrides,
  };
}

function song(id: string): Song {
  return {
    id,
    name: `song-${id}`,
    artist: 'artist',
    album: 'album',
    duration: 100,
    sourceType: 'netease',
    url: '',
    cover: '',
    lrc: '',
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function emitStatus(statusUpdate: AudioStatus): void {
  const player = audioMocks.players[audioMocks.players.length - 1];
  const listener = player.listeners.values().next().value;
  if (listener) listener(statusUpdate);
}

beforeEach(() => {
  usePlayerStore.setState({
    currentSong: null,
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  });
  audioMocks.players.length = 0;
  audioMocks.createAudioPlayer.mockClear();
});

afterEach(async () => {
  await cleanup();
});

describe('audioPlayer', () => {
  it('advances to the next song when loading fails', async () => {
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({
      queue: [first, second],
      currentIndex: 0,
      currentSong: first,
      isPlaying: true,
    });

    await playSong(first);
    emitStatus(status({ isLoaded: false, error: 'load failed' }));

    await vi.waitFor(() => expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2));
    await flush();

    expect(usePlayerStore.getState().currentSong?.id).toBe('2');
  });

  it('advances to the next song when the current track finishes', async () => {
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({
      queue: [first, second],
      currentIndex: 0,
      currentSong: first,
      isPlaying: true,
    });

    await playSong(first);
    emitStatus(status({ isLoaded: true, playing: false, didJustFinish: true, currentTime: 10, duration: 10 }));

    await vi.waitFor(() => expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2));
    await flush();

    expect(usePlayerStore.getState().currentSong?.id).toBe('2');
  });

  it('does not advance when the queue is exhausted after a load error', async () => {
    const first = song('1');
    usePlayerStore.setState({
      queue: [first],
      currentIndex: 0,
      currentSong: first,
      isPlaying: true,
    });

    await playSong(first);
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await flush();

    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().currentSong?.id).toBe('1');
  });
});
