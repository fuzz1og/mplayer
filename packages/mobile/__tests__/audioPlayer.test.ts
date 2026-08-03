import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from 'expo-audio';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { cleanup, playSong, seekTo, togglePlay } from '../services/audioPlayer';

type StatusListener = (status: AudioStatus) => void;

interface MockPlayer {
  id: number;
  uri: string;
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
  const createAudioPlayer = vi.fn((source: { uri: string }): MockPlayer => {
    const player: MockPlayer = {
      id: players.length + 1,
      uri: source.uri,
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
      remove: () => {
        // 模拟 expo-audio：原生释放是异步的，remove() 本身不保证停止播放
        if (audioMocks.removeThrows) throw new Error('remove failed');
      },
    };
    players.push(player);
    return player;
  });
  return {
    players,
    createAudioPlayer,
    removeThrows: false,
    resolvePlayableUrl: vi.fn(async (song: Song) => `https://example.com/${song.id}.mp3`),
    getAudioUrl: vi.fn(async (url: string) =>
      url === 'https://stale.example.com/1.mp3' ? 'https://fresh.example.com/1.mp3' : url
    ),
    getSodaAudioUrl: vi.fn(async () => ''),
    searchSongs: vi.fn(async (): Promise<Song[]> => []),
    clearByPrefix: vi.fn(),
    storageGet: null as string | null,
    storageSet: vi.fn(async () => {}),
  };
});

vi.mock('expo-audio', () => ({
  createAudioPlayer: audioMocks.createAudioPlayer,
  setAudioModeAsync: vi.fn(async () => {}),
}));

vi.mock('expo-constants', () => ({
  default: { expoGoConfig: null },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => audioMocks.storageGet),
    setItem: audioMocks.storageSet,
  },
}));

vi.mock('@mplayer/core', () => ({
  musicApi: {
    getAudioUrl: audioMocks.getAudioUrl,
    getSodaAudioUrl: audioMocks.getSodaAudioUrl,
    searchSongs: audioMocks.searchSongs,
  },
  resolvePlayableUrl: audioMocks.resolvePlayableUrl,
  cacheManager: { clearByPrefix: audioMocks.clearByPrefix },
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

function song(id: string, url = ''): Song {
  return {
    id,
    name: `song-${id}`,
    artist: 'artist',
    album: 'album',
    duration: 100,
    sourceType: 'netease',
    url,
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
  audioMocks.removeThrows = false;
  audioMocks.resolvePlayableUrl.mockClear();
  audioMocks.getAudioUrl.mockClear();
  audioMocks.getSodaAudioUrl.mockClear();
  audioMocks.searchSongs.mockClear();
  audioMocks.clearByPrefix.mockClear();
  audioMocks.storageGet = null;
  audioMocks.storageSet.mockClear();
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

describe('playback lifecycle races (user-reported)', () => {
  it('never leaves two players playing when switching songs', async () => {
    // 模拟 expo-audio 原生释放不立即生效：remove() 不停止播放
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    expect(audioMocks.players.filter(p => p.playing).length).toBe(1);

    await playSong(second);
    await flush();

    // 旧播放器必须已被暂停，而不是继续在后台播放
    expect(audioMocks.players.filter(p => p.playing).length).toBe(1);
    expect(audioMocks.players[0].playing).toBe(false);
    expect(audioMocks.players[1].playing).toBe(true);
  });

  it('keeps switching even when removing the old player throws', async () => {
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    audioMocks.removeThrows = true;

    await playSong(second).catch(() => {});
    await flush();

    // 清理失败不能卡死切歌：新歌必须能创建并播放
    expect(audioMocks.players.length).toBe(2);
    expect(audioMocks.players[1].playing).toBe(true);
  });

  it('advances only one step when didJustFinish fires twice', async () => {
    const first = song('1');
    const second = song('2');
    const third = song('3');
    usePlayerStore.setState({
      queue: [first, second, third],
      currentIndex: 0,
      currentSong: first,
      isPlaying: true,
    });

    await playSong(first);
    emitStatus(status({ isLoaded: true, playing: false, didJustFinish: true, currentTime: 10, duration: 10 }));
    emitStatus(status({ isLoaded: true, playing: false, didJustFinish: true, currentTime: 10, duration: 10 }));

    await flush();
    await flush();

    // 只应前进一首（到 song-2），而不是跳过 song-2 直接到 song-3
    expect(usePlayerStore.getState().currentSong?.id).toBe('2');
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2);
  });

  it('retries the same song with a fresh URL before skipping on load failure', async () => {
    // 收藏的歌曲 url 已过期（stale），首次加载失败后必须换新 URL 重试同一首
    const first = song('1', 'https://stale.example.com/1.mp3');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    emitStatus(status({ isLoaded: false, error: 'load failed: stale url' }));

    await vi.waitFor(() => expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2));
    await flush();

    expect(audioMocks.getAudioUrl).toHaveBeenCalledWith('https://stale.example.com/1.mp3');
    expect(audioMocks.players[1].uri).toBe('https://fresh.example.com/1.mp3');
    expect(usePlayerStore.getState().currentSong?.id).toBe('1');
  });

  it('pauses (not stuck playing) when the queue is exhausted after retries', async () => {
    // stale url：首试失败 → 新URL重试（创建播放器）→ 仍失败 → 队列耗尽必须暂停
    const first = song('1', 'https://stale.example.com/1.mp3');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await vi.waitFor(() => expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2));
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await flush();

    expect(usePlayerStore.getState().currentSong?.id).toBe('1');
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('logs a playback error when a song fails to load', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const first = song('1');
      const second = song('2');
      usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

      await playSong(first);
      emitStatus(status({ isLoaded: false, error: 'load failed' }));
      await flush();

      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('URL persistence cache (AsyncStorage songUrl:)', () => {
  it('uses the cached URL when the song has no direct url', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'https://cached.example.com/1.mp3';

    await playSong(first);

    expect(audioMocks.resolvePlayableUrl).not.toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://cached.example.com/1.mp3');
  });

  it('writes the resolved URL to the cache after playback starts', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);

    expect(audioMocks.storageSet).toHaveBeenCalledWith('songUrl:1', 'https://example.com/1.mp3');
  });

  it('ignores cached values that are not http URLs', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'undefined';

    await playSong(first);

    expect(audioMocks.resolvePlayableUrl).toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3');
  });

  it('does not write a cache entry when the song has no id', async () => {
    const first = song('');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);

    // historyStore persist 会写 'history' 键，但绝不能写 'songUrl:' 空键
    expect(audioMocks.storageSet).not.toHaveBeenCalledWith(expect.stringContaining('songUrl'));
  });
});

describe('togglePlay / seekTo', () => {
  it('pauses and resumes the current player', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    expect(audioMocks.players[0].playing).toBe(true);

    await togglePlay();
    expect(audioMocks.players[0].playing).toBe(false);
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    await togglePlay();
    expect(audioMocks.players[0].playing).toBe(true);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('retries with a fresh URL when toggling play with no player (queue exhausted)', async () => {
    const first = song('1', 'https://stale.example.com/1.mp3');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    // 首试失败 → 新 URL 重试 → 再失败 → 队列耗尽 → stopAllPlayers（player 置 null）
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await vi.waitFor(() => expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2));
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await flush();
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    // player 为 null → 用 fresh URL 重试当前歌曲（stale → fresh 直链）
    await togglePlay();
    await flush();

    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(3);
    expect(audioMocks.players[2].uri).toBe('https://fresh.example.com/1.mp3');
  });

  it('forwards seekTo to the current player', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    const seekSpy = vi.spyOn(audioMocks.players[0], 'seekTo').mockResolvedValue(undefined);

    await seekTo(30);

    expect(seekSpy).toHaveBeenCalledWith(30);
  });
});

describe('playId cancellation', () => {
  it('removes the previous song subscription on switch, ignoring stale status events', async () => {
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    const firstPlayer = audioMocks.players[0];
    // 切歌前先捕获旧 listener：即使事件在订阅移除前已被派发（极端时序），
    // playId guard 也必须忽略，不能额外创建播放器
    const staleListener = firstPlayer.listeners.values().next().value!;
    await playSong(second);

    // 切歌时旧播放器订阅必须已被移除（stopAllPlayers）
    expect(firstPlayer.listeners.size).toBe(0);

    staleListener(status({ isLoaded: true, playing: false, didJustFinish: true, currentTime: 10, duration: 10 }));
    await flush();

    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2);
    expect(audioMocks.players[1].playing).toBe(true);
  });

  it('cancels a pending playback when switching songs mid-resolution', async () => {
    // 迟到的 URL 解析（如慢网络）：切歌后解析完成也不能创建播放器
    let resolveUrl!: (v: string) => void;
    audioMocks.resolvePlayableUrl.mockImplementationOnce(
      () => new Promise<string>((r) => { resolveUrl = r; })
    );
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    const pendingFirst = playSong(first); // 停在 URL 解析
    await playSong(second);               // 切歌
    resolveUrl('https://late.example.com/1.mp3');
    await pendingFirst;
    await flush();

    // 迟到的解析被取消：只存在 song-2 的播放器
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3');
    expect(audioMocks.players[0].playing).toBe(true);
  });
});

describe('fresh URL resolution fallbacks', () => {
  it('falls back to re-search when redirect resolution returns the same URL', async () => {
    // getAudioUrl 返回与入参相同的 URL → 判定源 URL 失效 → 最后手段重新搜索
    const first = song('1', 'https://same.example.com/1.mp3');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.searchSongs.mockResolvedValueOnce([song('1', 'https://searched.example.com/1.mp3')]);

    await playSong(first, 0, true);

    expect(audioMocks.getAudioUrl).toHaveBeenCalledWith('https://same.example.com/1.mp3');
    expect(audioMocks.searchSongs).toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://searched.example.com/1.mp3');
  });

  it('uses the soda direct URL for soda songs on fresh retry', async () => {
    const first = song('1');
    first.sourceType = 'soda';
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.getSodaAudioUrl.mockResolvedValueOnce('https://soda.example.com/1.mp3');

    await playSong(first, 0, true);

    expect(audioMocks.getSodaAudioUrl).toHaveBeenCalledWith('1');
    expect(audioMocks.players[0].uri).toBe('https://soda.example.com/1.mp3');
  });
});
