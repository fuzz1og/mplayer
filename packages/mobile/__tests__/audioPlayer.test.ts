import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from 'expo-audio';
import type { Song } from '@mplayer/core';
import { clearSkipGuard, getFailureStreak, isKnownBadSong, registerTerminalFailure } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useAudioTagStore, tagKey } from '../stores/audioTagStore';
import { useLogsStore } from '../stores/logsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { cleanup, playSong, seekTo, togglePlay, fetchLrcInBackground } from '../services/audioPlayer';
import { updateNotification } from '../services/notificationService';

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
  updateLockScreenMetadata: (meta: { title?: string }) => void;
  /** 锁屏元数据更新记录（#405：曲末推进后必须显示当前这首） */
  lockScreenMeta: { title?: string }[];
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
      lockScreenMeta: [] as { title?: string }[],
      updateLockScreenMetadata: (meta: { title?: string }) => {
        player.lockScreenMeta.push(meta);
      },
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
    searchSongsRouted: vi.fn(async (): Promise<Song[]> => []),
    getLyrics: vi.fn(async (): Promise<string> => ''),
    resolvePlayableSongRouted: vi.fn(async (song: Song): Promise<{ url: string; nonFull: boolean }> =>
      song.url?.startsWith('file://')
        ? { url: song.url, nonFull: false }
        : { url: `https://example.com/${song.id}.mp3`, nonFull: false }
    ),
    isUrlAlive: vi.fn(async () => true),
    clearByPrefix: vi.fn(),
    storageGet: null as string | null,
    storageSet: vi.fn(async () => {}),
    storageSetLegacy: vi.fn(async () => {}),
    // 缓存 URL 年龄（cacheService.urlAgeMs mock 值）：null=未知（重启后）
    urlAge: null as number | null,
    // 缓存资源值的 nonFull（试听版命中）
    cachedNonFull: false,
    // 离线态（#385）：isOffline mock 的返回值
    offline: false,
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
      getLyrics: audioMocks.getLyrics,
      searchSongsRouted: audioMocks.searchSongsRouted,
      resolvePlayableSongRouted: audioMocks.resolvePlayableSongRouted,
    },
    isUrlAlive: audioMocks.isUrlAlive,
  };
});

vi.mock('../services/notificationService', () => ({
  updateNotification: vi.fn(async () => {}),
  clearNotification: vi.fn(async () => {}),
}));

// #385：离线判定隔离在 networkState（原生 NetInfo 在单测环境不可用）
vi.mock('../services/networkState', () => ({
  isOffline: vi.fn(async () => audioMocks.offline),
}));

vi.mock('../services/cacheService', () => ({
  getCachedResource: vi.fn(async (song: Song) => {
    const v = audioMocks.storageGet;
    return v?.startsWith('http') && song?.id
      ? { url: v, nonFull: audioMocks.cachedNonFull, ts: 0 }
      : null;
  }),
  setCachedResource: audioMocks.storageSet,
  deleteCachedResource: vi.fn(async () => {}),
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
  audioMocks.searchSongsRouted.mockClear();
  audioMocks.getLyrics.mockClear();
  audioMocks.resolvePlayableSongRouted.mockClear();
  audioMocks.clearByPrefix.mockClear();
  audioMocks.storageGet = null;
  audioMocks.storageSet.mockClear();
  audioMocks.storageSetLegacy.mockClear();
  audioMocks.isUrlAlive.mockClear();
  audioMocks.urlAge = null;
  audioMocks.cachedNonFull = false;
  audioMocks.offline = false;
  // 失败即跳默认 true（保持现状）；护栏模块级计数/坏歌记忆必须逐用例清空
  useSettingsStore.setState({ autoSkipOnError: true });
  clearSkipGuard();
  useAudioTagStore.setState({ tags: {} });
  useLogsStore.setState({ notice: null, entries: [] });
  vi.mocked(updateNotification).mockClear();
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

    // fresh 重试 = forgetPrefetchedUrl + 重走 routed 路由链：默认 mock 解析出全新直链
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3'));
    await flush();

    expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalledWith(first);
    expect(usePlayerStore.getState().currentSong?.id).toBe('1');
  });

  it('pauses (not stuck playing) when the queue is exhausted after retries', async () => {
    // stale url：首试失败 → 新URL重试（replace 换源）→ 仍失败 → 队列耗尽必须暂停
    const first = song('1', 'https://stale.example.com/1.mp3');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3'));
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

    expect(audioMocks.resolvePlayableSongRouted).not.toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe(local.url);
  });

  it('skips to the next song on failure without a fresh retry', async () => {
    // local 文件不会过期：加载失败直接跳歌，不走 fresh 重试/重新解析
    const local = song('1');
    local.sourceType = 'local';
    local.url = 'file:///data/local.mp3';
    const second = song('2');
    usePlayerStore.setState({ queue: [local, second], currentIndex: 0, currentSong: local, isPlaying: true });

    await playSong(local);
    emitStatus(status({ isLoaded: false, error: 'file not found' }));
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3'));
    await flush();

    expect(audioMocks.resolvePlayableSongRouted).not.toHaveBeenCalledWith(local);
    expect(usePlayerStore.getState().currentSong?.id).toBe('2');
  });
});

describe('URL persistence cache (AsyncStorage songUrl:)', () => {
  it('uses the cached URL when the song has no direct url', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'https://cached.example.com/1.mp3';

    await playSong(first);

    expect(audioMocks.resolvePlayableSongRouted).not.toHaveBeenCalled();
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
    expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalled();
    expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3');
  });

  it('writes the resolved URL to the cache after playback starts', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);

    expect(audioMocks.storageSet).toHaveBeenCalledWith(first, {
      url: 'https://example.com/1.mp3',
      nonFull: false,
      ts: expect.any(Number),
    });
  });

  it('缓存命中且 nonFull=true → 走试听版分支（提示 + preview 徽标），不回写 valid', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'https://cached.example.com/trial.mp3';
    audioMocks.cachedNonFull = true;

    await playSong(first);

    expect(audioMocks.players[0].uri).toBe('https://cached.example.com/trial.mp3');
    expect(useAudioTagStore.getState().tags[tagKey(first)]).toBe('preview');
    expect(useLogsStore.getState().notice?.text).toContain('试听版');
    // 缓存回写必须保留 nonFull（不得被收窄成"完整版"）
    expect(audioMocks.storageSet).toHaveBeenCalledWith(first, {
      url: 'https://cached.example.com/trial.mp3',
      nonFull: true,
      ts: expect.any(Number),
    });
    expect(audioMocks.resolvePlayableSongRouted).not.toHaveBeenCalled();
  });

  it('缓存命中完整版 → 回写 valid 徽标（试听分支未误伤正常路径）', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'https://cached.example.com/full.mp3';

    await playSong(first);

    expect(useAudioTagStore.getState().tags[tagKey(first)]).toBe('valid');
    expect(audioMocks.storageSet).toHaveBeenCalledWith(first, {
      url: 'https://cached.example.com/full.mp3',
      nonFull: false,
      ts: expect.any(Number),
    });
  });

  it('ignores cached values that are not http URLs', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.storageGet = 'undefined';

    await playSong(first);

    expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalled();
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
  it('no-url song resolves via routed chain (直连优先 → tier3 兜底)', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockResolvedValueOnce({ url: 'https://direct.example.com/1.mp3', nonFull: false });

    await playSong(first);

    expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalledWith(first);
    expect(audioMocks.players[0].uri).toBe('https://direct.example.com/1.mp3');
  });

  it('routed chain empty result → no legacy fallback; fresh retry re-walks the routed chain', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockResolvedValueOnce({ url: '', nonFull: false });

    await playSong(first);
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3'));
    await flush();

    // 首轮 routed 空 → 解析链穷尽；fresh 重试再走一次 routed（无 legacy 合并解析兜底）
    expect(audioMocks.resolvePlayableSongRouted.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('routed chain throw → error propagates; fresh retry re-walks the routed chain', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockRejectedValueOnce(new Error('路由链失败'));

    await playSong(first);
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3'));
    await flush();

    expect(audioMocks.resolvePlayableSongRouted.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('routed chain throw → 用 core 归因文案（#357），不降级为「音源解析失败」', async () => {
    const first = song('1');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    // 实时解析 + fresh 重试 + fresh 兜底各一次：解析链持续抛错（真机断网即此形态）
    audioMocks.resolvePlayableSongRouted.mockRejectedValueOnce(new Error('Network Error'));
    audioMocks.resolvePlayableSongRouted.mockRejectedValueOnce(new Error('Network Error'));
    audioMocks.resolvePlayableSongRouted.mockRejectedValueOnce(new Error('Network Error'));

    await playSong(first);
    await flush();

    // 解析链抛错与「返回空 URL」同属穷尽：Toast 文案来自 core explainPlaybackFailure
    // （测试环境 tier3 未开启 → tier3-disabled），而不是泛化的「音源解析失败」。
    const notice = useLogsStore.getState().notice;
    expect(notice?.text).toContain('第三方解析源（tier3）也未开启');
    expect(notice?.text).not.toContain('音源解析失败');
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
    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://example.com/1.mp3'));
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await flush();
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    // player 为 null → 用 fresh URL 重试当前歌曲（重新创建播放器）
    await togglePlay();
    await flush();

    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(2);
    expect(audioMocks.players[1].uri).toBe('https://example.com/1.mp3');
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
    let resolveUrl!: (v: { url: string; nonFull: boolean }) => void;
    audioMocks.resolvePlayableSongRouted.mockImplementationOnce(
      () => new Promise<{ url: string; nonFull: boolean }>((r) => { resolveUrl = r; })
    );
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    const pendingFirst = playSong(first); // 停在 URL 解析
    await playSong(second);               // 切歌
    resolveUrl({ url: 'https://late.example.com/1.mp3', nonFull: false });
    await pendingFirst;
    await flush();

    // 迟到的解析被取消：只存在 song-2 的播放器
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(audioMocks.players[0].uri).toBe('https://example.com/2.mp3');
    expect(audioMocks.players[0].playing).toBe(true);
  });
});

describe('fresh retry (forgetPrefetchedUrl + routed re-resolve)', () => {
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

    await playSong(first);
    await flush();

    expect(audioMocks.players[0]?.uri).toBe('https://prefetched.example.com/9.mp3');
    // #172 捷径消费了本次失败：routed 只被调用了 1 次（fresh 重跑会再调）
    expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalledTimes(1);
  });

  it('cache entry written before this attempt → shortcut skipped, fresh retry proceeds', async () => {
    // 缓存是本轮开始前的旧条目（探活已判死删除过的那类）→ 不能走捷径
    const first = song('9');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    audioMocks.resolvePlayableSongRouted.mockResolvedValueOnce({ url: '', nonFull: false });
    audioMocks.storageGet = 'https://stale-cache.example.com/9.mp3';
    audioMocks.urlAge = 30 * 60 * 1000; // 30min 前写入，早于本次播放开始
    // 旧条目已死：首轮探活必须判死（isUrlAlive 默认 mock 返回 true，会让
    // 首轮直接拿旧缓存播放、根本走不到「解析穷尽 → 捷径判定 → fresh 重试」）
    audioMocks.isUrlAlive.mockResolvedValueOnce(false);

    await playSong(first);
    // fresh 重试 = forgetPrefetchedUrl + 再走一次 routed（首轮 routed 返回空）
    await vi.waitFor(() => expect(audioMocks.resolvePlayableSongRouted.mock.calls.length).toBeGreaterThanOrEqual(2));
    await flush();

    expect(audioMocks.players.length).toBeGreaterThan(0);
    expect(audioMocks.players[0]?.uri).toBe('https://example.com/9.mp3');
  });
});

describe('试听版资源标记（nonFull 不得在外层缓存被擦掉）', () => {
  it('fresh 重试解析到试听版 → 保留 nonFull（preview 徽标，不回写 valid）', async () => {
    // 队列只有一首：后台预取提前返回，once 桩不会被预取消费（只留给 fresh 重试）
    const first = song('1', 'https://stale.example.com/1.mp3');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    audioMocks.resolvePlayableSongRouted.mockResolvedValueOnce({
      url: 'https://trial.example.com/1.mp3',
      nonFull: true,
    });
    emitStatus(status({ isLoaded: false, error: 'load failed' }));

    await vi.waitFor(() => expect(audioMocks.players[0].uri).toBe('https://trial.example.com/1.mp3'));
    await flush();

    expect(useAudioTagStore.getState().tags[tagKey(first)]).toBe('preview');
    expect(audioMocks.storageSet).toHaveBeenCalledWith(first, {
      url: 'https://trial.example.com/1.mp3',
      nonFull: true,
      ts: expect.any(Number),
    });
  });
});

describe('lyrics lazy refresh (fetchLrcInBackground)', () => {
  const STALE_LRC = 'https://api.example.com/lrc?id=1&sign=OLDSIGN&t=100';
  const FRESH_LRC = 'https://api.example.com/lrc?id=1&sign=NEWSIGN&t=200';

  it('fills an empty lrc URL from a strict search', async () => {
    // 用 qq：取词 URL 契约仍适用于非 songid 源（网易/汽水已改为按 ID 直取，#409）
    const first = { ...song('1'), sourceType: 'qq' as const };
    // routed 严格匹配搜索返回同名同歌手候选（findExactMatch 命中）
    audioMocks.searchSongsRouted.mockResolvedValueOnce([{ ...first, lrc: FRESH_LRC }]);
    usePlayerStore.setState({ currentSong: first, currentIndex: 0, queue: [first], isPlaying: true });

    await fetchLrcInBackground(first);

    expect(audioMocks.searchSongsRouted).toHaveBeenCalledWith('song-1 artist', 1, 'qq');
    expect(usePlayerStore.getState().currentSong?.lrc).toBe(FRESH_LRC);
    expect(audioMocks.getLyrics).toHaveBeenCalledWith(FRESH_LRC); // 歌词文本预取
  });

  it('lazy refresh (non-force) does NOT swap a URL that only changed sign', async () => {
    // 同一资源的新签名：归一化 key 相同 → 不替换（防止封面/歌词伪刷新）
    const first = { ...song('1', 'https://example.com/1.mp3'), sourceType: 'qq' as const };
    const cur = { ...first, lrc: STALE_LRC };
    audioMocks.searchSongsRouted.mockResolvedValueOnce([{ ...first, lrc: FRESH_LRC }]);
    usePlayerStore.setState({ currentSong: cur, currentIndex: 0, queue: [first], isPlaying: true });

    await fetchLrcInBackground(first);

    expect(usePlayerStore.getState().currentSong?.lrc).toBe(STALE_LRC);
    expect(audioMocks.getLyrics).not.toHaveBeenCalled();
  });

  it('force refresh DOES swap a stale lrc URL even when only the sign changed', async () => {
    // 歌词加载失败驱动（force）：旧 URL 已证明失效，新签名 URL 必须能换上来，
    // 否则归一化 key 相同会永远命中失效 URL，歌词再也刷新不出来
    const first = { ...song('1', 'https://example.com/1.mp3'), sourceType: 'qq' as const };
    const cur = { ...first, lrc: STALE_LRC };
    audioMocks.searchSongsRouted.mockResolvedValueOnce([{ ...first, lrc: FRESH_LRC }]);
    usePlayerStore.setState({ currentSong: cur, currentIndex: 0, queue: [first], isPlaying: true });

    await fetchLrcInBackground(first, true);

    expect(usePlayerStore.getState().currentSong?.lrc).toBe(FRESH_LRC);
    expect(audioMocks.getLyrics).toHaveBeenCalledWith(FRESH_LRC);
  });

  it('netease（#409 songid 源）：只处理封面，绝不搜索补词', async () => {
    // 列表结果不带词（lrc 恒空）后，若这里仍按「空 lrc → 搜索」处理，
    // 每播一首就会多打一次搜索请求，正好把 #409 省下的请求打回来。
    const ne = { ...song('1'), cover: '' };
    audioMocks.searchSongsRouted.mockResolvedValueOnce([{
      ...ne,
      cover: 'https://p1.music.126.net/new.jpg',
      lrc: '',
    }]);
    usePlayerStore.setState({ currentSong: ne, currentIndex: 0, queue: [ne], isPlaying: true });

    await fetchLrcInBackground(ne);

    expect(usePlayerStore.getState().currentSong?.cover).toBe('https://p1.music.126.net/new.jpg');
    expect(usePlayerStore.getState().currentSong?.lrc).toBe('');
    expect(audioMocks.getLyrics).not.toHaveBeenCalled();
  });

  it('netease 封面已在且未要求刷新 → 一次搜索都不打（#409 关键回归断言）', async () => {
    const ne = { ...song('1'), cover: 'https://p1.music.126.net/x.jpg' };
    usePlayerStore.setState({ currentSong: ne, currentIndex: 0, queue: [ne], isPlaying: true });

    await fetchLrcInBackground(ne);

    expect(audioMocks.searchSongsRouted).not.toHaveBeenCalled();
    expect(audioMocks.getLyrics).not.toHaveBeenCalled();
  });

  it('soda: only fills cover, never swaps lrc (search has no lrc; lyrics come from share page)', async () => {
    // 汽水搜索不带 lrc（searchSongsSoda 恒空），fetchLrcInBackground 只处理封面；
    // 歌词由 PlayerOverlay 直取分享页（getSodaLyrics），不经过 song.lrc URL 契约
    const soda = { ...song('9'), sourceType: 'soda' as const, cover: '' };
    const cur = { ...soda, cover: '' };
    audioMocks.searchSongsRouted.mockResolvedValueOnce([{
      ...soda,
      cover: 'https://p3-luna.douyinpic.com/img/x~c5_375x375.jpg',
      lrc: '', // soda 搜索恒空 lrc
    }]);
    usePlayerStore.setState({ currentSong: cur, currentIndex: 0, queue: [soda], isPlaying: true });

    await fetchLrcInBackground(soda);

    // 封面补上了
    expect(usePlayerStore.getState().currentSong?.cover).toBe('https://p3-luna.douyinpic.com/img/x~c5_375x375.jpg');
    // 歌词 URL 未被设置（保持空，由 PlayerOverlay 直取分享页歌词）
    expect(usePlayerStore.getState().currentSong?.lrc).toBe('');
    // 未预取歌词文本（无 lrc URL 可拉）
    expect(audioMocks.getLyrics).not.toHaveBeenCalled();
  });
});

describe('跳歌护栏（#385 core skipGuard 接线）', () => {
  /** 让当前歌走完「首轮失败 → fresh 重试 → 再失败」的终局路径 */
  async function failCurrentSongTerminally(): Promise<void> {
    const before = audioMocks.players[0].replaceCalls ?? 0;
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await vi.waitFor(() => expect(audioMocks.players[0].replaceCalls ?? 0).toBeGreaterThan(before));
    emitStatus(status({ isLoaded: false, error: 'load failed' }));
    await flush();
  }

  it('断网 → 不进解析链：直接停并提示「离线」（不计数、不跳歌）', async () => {
    audioMocks.offline = true;
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    await flush();

    // 离网快速失败（#385 D3）：一次上游解析都不发，连同曲 fresh 重试都没有
    expect(audioMocks.resolvePlayableSongRouted).not.toHaveBeenCalled();
    expect(audioMocks.players[0]?.replaceCalls ?? 0).toBe(0);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().currentSong?.id).toBe('1');
    expect(useLogsStore.getState().notice?.text).toContain('离线');
    // 离线不是「源失败」：不计数、不写坏歌记忆
    expect(getFailureStreak()).toBe(0);
    expect(isKnownBadSong(first)).toBe(false);
  });

  it('连续失败达固定上限 3 → 停（与队列长度无关）', async () => {
    const queue = [song('1'), song('2'), song('3'), song('4')];
    usePlayerStore.setState({ queue, currentIndex: 0, currentSong: queue[0], isPlaying: true });

    await playSong(queue[0]);
    // 第 1、2 首：终局失败 → 自动跳到下一首（计数 1、2）
    for (let i = 0; i < 2; i += 1) {
      await failCurrentSongTerminally();
      await vi.waitFor(() => expect(usePlayerStore.getState().currentSong?.id).toBe(String(i + 2)));
    }
    // 第 3 首：计数达 SKIP_LIMIT → 停
    await failCurrentSongTerminally();
    await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));

    expect(getFailureStreak()).toBe(3);
    expect(usePlayerStore.getState().currentSong?.id).toBe('3');
    expect(useLogsStore.getState().notice?.text).toContain('连续 3 首无法播放');
  });

  it('autoSkipOnError=false → 失败即停（文案含「自动跳歌已关闭」）', async () => {
    useSettingsStore.setState({ autoSkipOnError: false });
    const first = song('1');
    const second = song('2');
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0, currentSong: first, isPlaying: true });

    await playSong(first);
    await failCurrentSongTerminally();
    await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));

    expect(usePlayerStore.getState().currentSong?.id).toBe('1');
    expect(useLogsStore.getState().notice?.text).toContain('自动跳歌已关闭');
  });

  it('已记坏歌不再被选中（跳歌跳过它）', async () => {
    const first = song('1');
    const bad = song('2');
    const third = song('3');
    usePlayerStore.setState({ queue: [first, bad, third], currentIndex: 0, currentSong: first, isPlaying: true });
    // bad 在会话内已被证明失效（如更早一轮失败）
    registerTerminalFailure(bad);

    await playSong(first);
    await failCurrentSongTerminally();

    await vi.waitFor(() => expect(usePlayerStore.getState().currentSong?.id).toBe('3'));
    expect(audioMocks.players[0].uri).toBe('https://example.com/3.mp3');
  });

  it('成功开始播放 → 连续失败计数归零（手动点歌不清零由 core 语义保证）', async () => {
    registerTerminalFailure(song('1'));
    registerTerminalFailure(song('2'));
    expect(getFailureStreak()).toBe(2);

    const first = song('3');
    usePlayerStore.setState({ queue: [first], currentIndex: 0, currentSong: first, isPlaying: true });
    await playSong(first);
    // 加载成功（出声）事件才是「成功开始播放」：移动端 play() 返回不代表能出声
    emitStatus(status({ isLoaded: true, playing: true }));

    expect(getFailureStreak()).toBe(0);
  });
});

describe('#405 曲末推进（后台播放可靠性）', () => {
  /** 曲末状态：ExoPlayer 播完（原生 ENDED 边沿） */
  const FINISH = { isLoaded: true, playing: false, didJustFinish: true, currentTime: 100, duration: 100 };

  function seedQueue(songs: Song[], index = 0, playMode = '列表循环'): void {
    useSettingsStore.setState({ playMode: playMode as never });
    usePlayerStore.setState({
      queue: songs,
      currentIndex: index,
      currentSong: songs[index],
      isPlaying: true,
    });
  }

  // 注意：预取去重表是**会话级**的（同一首不重复解析），所以每个用例用独立 song id，
  // 否则前一个用例预取过的 id 会把后一个用例的预取直接短路掉。

  it('曲末推进不依赖定时器：didJustFinish 后同一 tick 完成 replace + play（不留 ENDED 窗口）', async () => {
    const first = song('b1');
    // 下一首自带直链（收藏/历史/换源后的常态）→ 曲末可在同一同步 tick 换源
    const second = song('b2', 'https://cdn.example.com/b2.mp3');
    seedQueue([first, second]);

    await playSong(first);
    const p = audioMocks.players[0];

    emitStatus(status(FINISH));

    // 不 await 任何 timer / 微任务：store 与播放器都必须已经切到第二首。
    // 旧实现是 setTimeout(…, 0)，本断言就是「不再多一跳」的回归门。
    expect(usePlayerStore.getState().currentSong?.id).toBe('b2');
    expect(p.uri).toBe('https://cdn.example.com/b2.mp3');
    expect(p.playing).toBe(true);
    // 单播放器复用：不新建实例（不出现两首同播）
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(audioMocks.players.filter(x => x.playing).length).toBe(1);
  });

  it('预取交接槽命中 → 曲末同一 tick 换源（不留 ENDED 窗口）', async () => {
    const first = song('c1');
    const second = song('c2'); // 无自带 url：只能靠预取拿到直链
    seedQueue([first, second]);

    await playSong(first);
    // 等起播时那次预取把直链写进交接槽（同一份也写缓存）
    await vi.waitFor(() =>
      expect(audioMocks.storageSet).toHaveBeenCalledWith(
        second,
        expect.objectContaining({ url: 'https://example.com/c2.mp3' })
      )
    );
    const p = audioMocks.players[0];

    emitStatus(status(FINISH));

    expect(usePlayerStore.getState().currentSong?.id).toBe('c2');
    expect(p.uri).toBe('https://example.com/c2.mp3');
    expect(p.playing).toBe(true);
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
  });

  it('同步换源路径下曲末事件连发也只前进一首（重入守卫）', async () => {
    const first = song('d1');
    const second = song('d2', 'https://cdn.example.com/d2.mp3');
    const third = song('d3', 'https://cdn.example.com/d3.mp3');
    seedQueue([first, second, third]);

    await playSong(first);
    emitStatus(status(FINISH));
    emitStatus(status(FINISH)); // 同一 ENDED 态重复上报
    await flush();

    expect(usePlayerStore.getState().currentSong?.id).toBe('d2');
    expect(audioMocks.players[0].uri).toBe('https://cdn.example.com/d2.mp3');
  });

  it('队列播完（store 已无下一首）→ 停播并同步 store 为暂停', async () => {
    const first = song('e1');
    seedQueue([first]);
    await playSong(first);
    const p = audioMocks.players[0];
    const uriBefore = p.uri;

    // 队列被清空（用户清空队列 / 条目被移除）：曲末无下一首 → 收尾
    usePlayerStore.setState({ queue: [], currentIndex: -1 });
    emitStatus(status(FINISH));
    await flush();

    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(p.uri).toBe(uriBefore);
    expect(
      useLogsStore.getState().entries.some(e => e.message.includes('[推进]') && e.message.includes('song-e1'))
    ).toBe(true);
  });

  it('单曲循环：曲末重播当前首（不换歌、不重建播放器）', async () => {
    const first = song('f1');
    const second = song('f2', 'https://cdn.example.com/f2.mp3');
    seedQueue([first, second], 0, '单曲循环');

    await playSong(first);
    const p = audioMocks.players[0];
    emitStatus(status(FINISH));
    await flush();

    expect(usePlayerStore.getState().currentSong?.id).toBe('f1');
    expect(p.uri).toBe('https://example.com/f1.mp3');
    expect(p.playing).toBe(true);
    expect(audioMocks.createAudioPlayer).toHaveBeenCalledTimes(1);
  });

  it('随机播放：曲末推进到 core getNextSongIndex 选出的下一首（不重复当前首）', async () => {
    const queue = [
      song('g1'),
      song('g2', 'https://cdn.example.com/g2.mp3'),
      song('g3', 'https://cdn.example.com/g3.mp3'),
    ];
    seedQueue(queue, 0, '随机播放');

    await playSong(queue[0]);
    emitStatus(status(FINISH));
    await flush();

    const id = usePlayerStore.getState().currentSong?.id;
    expect(id === 'g2' || id === 'g3').toBe(true);
    expect(audioMocks.players[0].uri).toBe(`https://cdn.example.com/${id}.mp3`);
  });

  it('列表循环：末首曲末回卷到队首（队列不算播完）', async () => {
    const first = song('h1', 'https://cdn.example.com/h1.mp3');
    const second = song('h2', 'https://cdn.example.com/h2.mp3');
    seedQueue([first, second], 1);

    await playSong(second);
    emitStatus(status(FINISH));
    await flush();

    expect(usePlayerStore.getState().currentSong?.id).toBe('h1');
    expect(audioMocks.players[0].uri).toBe('https://cdn.example.com/h1.mp3');
  });

  it('预取提前：剩余 ≤15s 触发下一首预取，重复状态更新不重复解析', async () => {
    const first = song('i1');
    const second = song('i2');
    seedQueue([first]);
    await playSong(first); // 队列只有一首：起播时的预取提前返回
    await flush();
    audioMocks.resolvePlayableSongRouted.mockClear();

    // 播放中队列补上下一首（列表懒加载常态）
    usePlayerStore.setState({ queue: [first, second], currentIndex: 0 });

    // 剩余 90s：不触发预取
    emitStatus(status({ isLoaded: true, playing: true, currentTime: 10, duration: 100 }));
    await flush();
    expect(audioMocks.resolvePlayableSongRouted).not.toHaveBeenCalled();

    // 剩余 10s：触发一次
    emitStatus(status({ isLoaded: true, playing: true, currentTime: 90, duration: 100 }));
    await vi.waitFor(() => expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalledWith(second));
    expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalledTimes(1);

    // 状态更新 250ms 一次：同一首不得重复解析
    emitStatus(status({ isLoaded: true, playing: true, currentTime: 91, duration: 100 }));
    emitStatus(status({ isLoaded: true, playing: true, currentTime: 92, duration: 100 }));
    await flush();
    expect(audioMocks.resolvePlayableSongRouted).toHaveBeenCalledTimes(1);
  });

  it('起播时已成功预取的下一首，剩余 ≤15s 不再重复解析（成功即记入去重表）', async () => {
    const first = song('j1');
    const second = song('j2');
    seedQueue([first, second]);

    await playSong(first);
    await vi.waitFor(() =>
      expect(audioMocks.storageSet).toHaveBeenCalledWith(second, expect.anything())
    );
    const resolvedSecond = () =>
      audioMocks.resolvePlayableSongRouted.mock.calls.filter(c => (c[0] as Song).id === 'j2').length;
    expect(resolvedSecond()).toBe(1);

    emitStatus(status({ isLoaded: true, playing: true, currentTime: 90, duration: 100 }));
    await flush();

    expect(resolvedSecond()).toBe(1);
  });

  it('推进后立即刷新锁屏元数据与通知（显示当前这首）', async () => {
    const first = song('k1');
    const second = song('k2', 'https://cdn.example.com/k2.mp3');
    seedQueue([first, second]);

    await playSong(first);
    vi.mocked(updateNotification).mockClear();
    audioMocks.players[0].lockScreenMeta.length = 0;

    emitStatus(status(FINISH));

    expect(audioMocks.players[0].lockScreenMeta.at(-1)?.title).toBe('song-k2');
    expect(vi.mocked(updateNotification)).toHaveBeenCalledWith(second, true);
  });

  it('曲末推进留下常驻诊断日志（回答后台 didJustFinish 到底有没有到）', async () => {
    const first = song('l1');
    const second = song('l2', 'https://cdn.example.com/l2.mp3');
    seedQueue([first, second]);

    await playSong(first);
    useLogsStore.setState({ entries: [] });

    emitStatus(status(FINISH));

    const messages = useLogsStore.getState().entries.map(e => e.message);
    expect(messages.some(m => m.includes('[推进]') && m.includes('song-l1') && m.includes('song-l2'))).toBe(true);
  });
});
