import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from 'expo-audio';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { cleanup, playSong, seekTo, togglePlay, fetchLrcInBackground } from '../services/audioPlayer';

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
  replace: (source: { uri: string }) => void;
  replaceCalls?: number;
  updateLockScreenMetadata: () => void;
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
      updateLockScreenMetadata: () => {},
      replace: (source: { uri: string }) => {
        // 单播放器复用：replace 换源不创建新实例
        player.uri = source.uri;
        player.replaceCalls = (player.replaceCalls ?? 0) + 1;
      },
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
    resolvePlayableSong: vi.fn(async (song: Song) =>
      song.url?.startsWith('file://')
        ? { url: song.url, lrc: '' }
        : { url: `https://example.com/${song.id}.mp3`, lrc: '' }
    ),
    getAudioUrl: vi.fn(async (url: string) =>
      url === 'https://stale.example.com/1.mp3' ? 'https://fresh.example.com/1.mp3' : url
    ),
    getSodaAudioUrl: vi.fn(async () => ''),
    searchSongs: vi.fn(async (): Promise<Song[]> => []),
    searchSongById: vi.fn(async (): Promise<Song | null> => null),
    getLyrics: vi.fn(async (): Promise<string> => ''),
    resolvePlayableSongRouted: vi.fn(async (): Promise<{ url: string; nonFull: boolean }> => ({ url: '', nonFull: false })),
    isUrlAlive: vi.fn(async () => true),
    clearByPrefix: vi.fn(),
    storageGet: null as string | null,
    storageSet: vi.fn(async () => {}),
    storageSetLegacy: vi.fn(async () => {}),
    // 缓存 URL 年龄（cacheService.urlAgeMs mock 值）：null=未知（重启后）
    urlAge: null as number | null,
  };
});

vi.mock('expo-audio', () => ({
  createAudioPlayer: audioMocks.createAudioPlayer,
  setAudioModeAsync: vi.fn(async () => {}),
}));

vi.mock('expo-constants', () => ({
  AppOwnership: { Expo: 'expo' },
  default: { appOwnership: null },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => audioMocks.storageGet),
    setItem: audioMocks.storageSetLegacy,
  },
}));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  return {
    ...actual,
    musicApi: {
      getAudioUrl: audioMocks.getAudioUrl,
      getSodaAudioUrl: audioMocks.getSodaAudioUrl,
      searchSongs: audioMocks.searchSongs,
      searchSongById: audioMocks.searchSongById,
      getLyrics: audioMocks.getLyrics,
      resolvePlayableSongRouted: audioMocks.resolvePlayableSongRouted,
    },
    resolvePlayableUrl: audioMocks.resolvePlayableUrl,
    resolvePlayableSong: audioMocks.resolvePlayableSong,
    isUrlAlive: audioMocks.isUrlAlive,
    cacheManager: { clearByPrefix: audioMocks.clearByPrefix },
  };
});

vi.mock('../services/notificationService', () => ({
  updateNotification: vi.fn(async () => {}),
  clearNotification: vi.fn(async () => {}),
}));

vi.mock('../services/cacheService', () => ({
  getCachedUrl: vi.fn(async (songId: string) => {
    const v = audioMocks.storageGet;
    return v?.startsWith('http') && songId ? v : null;
  }),
  setCachedUrl: audioMocks.storageSet,
  deleteCachedUrl: vi.fn(async () => {}),
  urlAgeMs: vi.fn(() => audioMocks.urlAge),
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
  audioMocks.searchSongById.mockClear();
  audioMocks.getLyrics.mockClear();
  audioMocks.resolvePlayableSongRouted.mockClear();
  audioMocks.resolvePlayableSong.mockClear();
  audioMocks.clearByPrefix.mockClear();
  audioMocks.storageGet = null;
  audioMocks.storageSet.mockClear();
  audioMocks.storageSetLegacy.mockClear();
  audioMocks.isUrlAlive.mockClear();
  audioMocks.urlAge = null;
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

    // fresh 重试带路由链兜底：解析出替代 URL 会再起播一次（replace 第 2 次）；
    // 仍失败（第二次错误事件）才跳歌——两次失败都注入，验证最终推进到下一首
    // 首播走 createAudioPlayer（rc=0），fresh 重试走 replace（rc=1）：
    // replace 发生 = 兜底解析完成并二次起播，此时才注入第二次失败
    await vi.waitFor(() => expect(audioMocks.players[0].replaceCalls).toBe(1));
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3'), { timeout: 4000 });
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

    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3'));
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

    // 单播放器复用：只有一个实例（replace 换源），不存在「两个播放器」。
    // 切歌后唯一播放器播放第二首——双播放根治的回归断言。
    expect(audioMocks.players.length).toBe(1);
    expect(audioMocks.players[0].playing).toBe(true);
    expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3');
  });

  it('keeps switching even when removing the old player throws', async () => {
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    audioMocks.removeThrows = true;

    await playSong(second).catch(() => {});
    await flush();

    // 单播放器复用：切歌走 replace（不 remove），remove 抛错不影响切歌
    expect(audioMocks.players.length).toBe(1);
    expect(audioMocks.players[0].playing).toBe(true);
    expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3');
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
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
  });

  it('retries the same song with a fresh URL before skipping on load failure', async () => {
    // 收藏的歌曲 url 已过期（stale），首次加载失败后必须换新 URL 重试同一首
    const first = song('1', 'https://stale.example.com/1.mp3');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    emitStatus(status({ isLoaded: false, error: 'load failed: stale url' }));

    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://fresh.example.com/1.mp3'));
    await flush();

    expect(audioMocks.getAudioUrl).toHaveBeenCalledWith('https://stale.example.com/1.mp3');
    expect(usePlayerStore.getState().currentSong?.id).toBe('1');
  });

  it('pauses (not stuck playing) when the queue is exhausted after retries', async () => {
    // stale url：首试失败 → 新URL重试（replace 换源）→ 仍失败 → 队列耗尽必须暂停
    const first = song('1', 'https://stale.example.com/1.mp3');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://fresh.example.com/1.mp3'));
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

describe('local file playback (downloads)', () => {
  it('uses a file:// URL directly without resolution', async () => {
    const local = song('1');
    local.sourceType = 'local';
    local.url = 'file:///data/user/0/host.exp.exponent/files/mplayer-downloads/晴天 - 周杰伦.mp3';
    usePlayerStore.setState({ queue: [local], currentIndex: 0, currentSong: local, isPlaying: true });

    await playSong(local);

    expect(audioMocks.resolvePlayableUrl).not.toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe(local.url);
  });

  it('skips to the next song on failure without a fresh retry', async () => {
    // local 文件不会过期：加载失败直接跳歌，不走 fresh 重试/重新搜索
    const local = song('1');
    local.sourceType = 'local';
    local.url = 'file:///data/local.mp3';
    const second = song('2');
    usePlayerStore.setState({ queue: [local, second], currentIndex: 0, currentSong: local, isPlaying: true });

    await playSong(local);
    emitStatus(status({ isLoaded: false, error: 'file not found' }));
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3'));
    await flush();

    expect(audioMocks.getAudioUrl).not.toHaveBeenCalled();
    expect(audioMocks.searchSongs).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentSong?.id).toBe('2');
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

  it('young cached URL (under 10min) skips the liveness probe', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'https://cached.example.com/1.mp3';
    audioMocks.urlAge = 60 * 1000; // Just written 1 minute ago

    await playSong(first);

    expect(audioMocks.isUrlAlive).not.toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://cached.example.com/1.mp3');
  });

  it('stale cached URL fails the probe and re-resolves instead of dead-waiting on the player', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'https://cached.example.com/1.mp3';
    audioMocks.urlAge = 15 * 60 * 1000; // Older than the young window
    audioMocks.isUrlAlive.mockResolvedValueOnce(false); // Probe finds a dead link

    await playSong(first);

    expect(audioMocks.isUrlAlive).toHaveBeenCalledWith('https://cached.example.com/1.mp3');
    expect(audioMocks.resolvePlayableSong).toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3');
  });

  it('writes the resolved URL to the cache after playback starts', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);

    expect(audioMocks.storageSet).toHaveBeenCalledWith('1', 'https://example.com/1.mp3');
  });

  it('ignores cached values that are not http URLs', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'undefined';

    await playSong(first);

    expect(audioMocks.resolvePlayableSong).toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3');
  });

  it('does not write a cache entry when the song has no id', async () => {
    const first = song('');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);

    expect(audioMocks.storageSet).not.toHaveBeenCalled();
  });
});

describe('direct-first playback (spec #146 §8 移动端直连)', () => {
  it('no-url song resolves via routed chain (直连优先) instead of legacy search', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockResolvedValueOnce({ url: 'https://direct.example.com/1.mp3', nonFull: false });

    await playSong(first);

    expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalledWith(first);
    expect(audioMocks.resolvePlayableSong).not.toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://direct.example.com/1.mp3');
  });

  it('routed chain empty result → falls back to legacy resolvePlayableSong', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockResolvedValueOnce({ url: '', nonFull: false });

    await playSong(first);

    expect(audioMocks.resolvePlayableSong).toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3');
  });

  it('routed chain throw → falls back to legacy resolvePlayableSong', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockRejectedValueOnce(new Error('路由链失败'));

    await playSong(first);

    expect(audioMocks.resolvePlayableSong).toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3');
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
    // 首试失败 → 新 URL 重试（replace 换源）→ 再失败 → 队列耗尽 → stopAllPlayers（player 置 null）
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://fresh.example.com/1.mp3'));
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await flush();
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    // player 为 null → 用 fresh URL 重试当前歌曲（重新创建播放器）
    await togglePlay();
    await flush();

    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2);
    expect(audioMocks.players[1].uri).toBe('https://fresh.example.com/1.mp3');
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
  it('reuses the singleton player via replace on switch (no second instance)', async () => {
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    const firstPlayer = audioMocks.players[0];
    // 切歌：单播放器复用（replace 换源），不创建第二个 ExoPlayer 实例
    await playSong(second);

    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(audioMocks.players.length).toBe(1);
    expect(firstPlayer.uri).toBe('https://example.com/2.mp3');
    expect(firstPlayer.playing).toBe(true);
  });

  it('cancels a pending playback when switching songs mid-resolution', async () => {
    // 迟到的 URL 解析（如慢网络）：切歌后解析完成也不能创建播放器
    let resolveUrl!: (v: { url: string; lrc: string }) => void;
    audioMocks.resolvePlayableSong.mockImplementationOnce(
      () => new Promise<{ url: string; lrc: string }>((r) => { resolveUrl = r; })
    );
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    const pendingFirst = playSong(first); // 停在 URL 解析
    await playSong(second);               // 切歌
    resolveUrl({ url: 'https://late.example.com/1.mp3', lrc: '' });
    await pendingFirst;
    await flush();

    // 迟到的解析被取消：只存在 song-2 的播放器
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3');
    expect(audioMocks.players[0].playing).toBe(true);
  });
});

describe('fresh URL resolution fallbacks', () => {
  it('resolution exhausted + cache written mid-flight → plays the prefetched URL instead of a fresh rerun', async () => {
    // #172 场景：前台解析链穷尽失败时，后台预取恰好在解析期间拿到直链写入缓存
    //（后台 3s 命中、前台 6s 预算耗尽的时序差）。此时应直接用缓存重播，
    // 而不是再跑一轮 fresh 全链（实测 ~6s 白等）。
    const first = song('9');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockImplementationOnce(async () => {
      // 解析期间「后台预取」写入缓存（刚写入：age≈0 → 本轮开始后新写入）
      audioMocks.storageGet = 'https://prefetched.example.com/9.mp3';
      audioMocks.urlAge = 0;
      return { url: '', nonFull: false };
    });
    // legacy 兜底也空 → 解析链穷尽（no playable URL）
    audioMocks.resolvePlayableSong.mockResolvedValueOnce({ url: '', lrc: '' });

    await playSong(first);
    await flush();

    expect(audioMocks.players[0]?.uri).toBe('https://prefetched.example.com/9.mp3');
    // fresh 全链未跑：resolveFreshUrl 入口无条件 clearAudioUrlCache（clearByPrefix），
    // 这是 fresh 链独有的信号。searchSongById 不能当判据——歌词懒刷新
    // （fetchLrcInBackground → searchStrictMatch）同样按 ID 搜歌（2 参调用），
    // 本用例两次 playSong（首试 + 缓存重播）各触发一次，与 fresh 链无关。
    expect(audioMocks.clearByPrefix).not.toHaveBeenCalled();
  });

  it('cache entry written before this attempt → shortcut skipped, fresh retry proceeds', async () => {
    // 缓存是本轮开始前的旧条目（探活已判死删除过的那类）→ 不能走捷径
    const first = song('9');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockResolvedValueOnce({ url: '', nonFull: false });
    audioMocks.resolvePlayableSong.mockResolvedValueOnce({ url: '', lrc: '' });
    audioMocks.storageGet = 'https://stale-cache.example.com/9.mp3';
    audioMocks.urlAge = 30 * 60 * 1000; // 30min 前写入，早于本次播放开始
    // 旧条目已死：首轮探活必须判死（isUrlAlive 默认 mock 返回 true，会让
    // 首轮直接拿旧缓存播放、根本走不到「解析穷尽 → 捷径判定 → fresh 重试」）
    audioMocks.isUrlAlive.mockResolvedValueOnce(false);

    await playSong(first);
    await vi.waitFor(() => expect(audioMocks.searchSongById).toHaveBeenCalled());
    await flush();

    // fresh 重试链被走到（而非拿旧缓存重播）：strict 搜索全空后落到
    // legacy 默认兜底解析出全新直链（正向断言，players 为空时不会空过）
    expect(audioMocks.players.length).toBeGreaterThan(0);
    expect(audioMocks.players[0]?.uri).toBe('https://example.com/9.mp3');
  });

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

describe('lyrics lazy refresh (fetchLrcInBackground)', () => {
  const STALE_LRC = 'https://api.example.com/lrc?id=1&sign=OLDSIGN&t=100';
  const FRESH_LRC = 'https://api.example.com/lrc?id=1&sign=NEWSIGN&t=200';

  it('fills an empty lrc URL from a strict search', async () => {
    const first = song('1');
    audioMocks.searchSongById.mockResolvedValueOnce({ ...first, lrc: FRESH_LRC });
    usePlayerStore.setState({ currentSong: first, currentIndex: 0, queue: [first], isPlaying: true });

    await fetchLrcInBackground(first);

    expect(audioMocks.searchSongById).toHaveBeenCalled();
    expect(usePlayerStore.getState().currentSong?.lrc).toBe(FRESH_LRC);
    expect(audioMocks.getLyrics).toHaveBeenCalledWith(FRESH_LRC); // 歌词文本预取
  });

  it('lazy refresh (non-force) does NOT swap a URL that only changed sign', async () => {
    // 同一资源的新签名：归一化 key 相同 → 不替换（防止封面/歌词伪刷新）
    const first = song('1', 'https://example.com/1.mp3');
    const cur = { ...first, lrc: STALE_LRC };
    audioMocks.searchSongById.mockResolvedValueOnce({ ...first, lrc: FRESH_LRC });
    usePlayerStore.setState({ currentSong: cur, currentIndex: 0, queue: [first], isPlaying: true });

    await fetchLrcInBackground(first);

    expect(usePlayerStore.getState().currentSong?.lrc).toBe(STALE_LRC);
    expect(audioMocks.getLyrics).not.toHaveBeenCalled();
  });

  it('force refresh DOES swap a stale lrc URL even when only the sign changed', async () => {
    // 歌词加载失败驱动（force）：旧 URL 已证明失效，新签名 URL 必须能换上来，
    // 否则归一化 key 相同会永远命中失效 URL，歌词再也刷新不出来
    const first = song('1', 'https://example.com/1.mp3');
    const cur = { ...first, lrc: STALE_LRC };
    audioMocks.searchSongById.mockResolvedValueOnce({ ...first, lrc: FRESH_LRC });
    usePlayerStore.setState({ currentSong: cur, currentIndex: 0, queue: [first], isPlaying: true });

    await fetchLrcInBackground(first, true);

    expect(usePlayerStore.getState().currentSong?.lrc).toBe(FRESH_LRC);
    expect(audioMocks.getLyrics).toHaveBeenCalledWith(FRESH_LRC);
  });
});

