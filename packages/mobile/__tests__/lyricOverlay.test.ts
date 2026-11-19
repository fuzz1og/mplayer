import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';

// expo-file-system 的模块初始化读 RN 运行时全局 `__DEV__`（node 测试环境没有）
(globalThis as unknown as { __DEV__?: boolean }).__DEV__ = false;

/**
 * #775 Android 歌词浮窗的 JS 宿主：开关意图单向回灌、整表推送 / 切曲清表 / 空词隐藏、
 * serviceState 重启重推、权限撤销事件。原生窗口本身不在 node 测试范围内。
 */

const fake = vi.hoisted(() => {
  type Line = { time: number; text: string };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const calls = {
    setLines: [] as { trackKey: string; lines: Line[] }[],
    enabled: [] as boolean[],
    settingsOpened: 0,
  };
  let state = { enabled: false, permission: false, attached: false, touchable: false };
  const module = {
    canDrawOverlays: () => state.permission,
    openOverlaySettings: () => {
      calls.settingsOpened += 1;
    },
    isLyricOverlaySupported: () => true,
    setLyricOverlayEnabled: (enabled: boolean) => {
      calls.enabled.push(enabled);
      state = { ...state, enabled };
      return state;
    },
    getLyricOverlayState: () => state,
    setLyricLines: (trackKey: string, lines: Line[]) => {
      calls.setLines.push({ trackKey, lines });
    },
    addListener: (name: string, listener: (payload: unknown) => void) => {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener);
      return { remove: () => set!.delete(listener) };
    },
    registerHeadlessHost: () => true,
    isServiceRunning: () => true,
    getState: () => ({
      revision: 0,
      index: 0,
      playing: false,
      playWhenReady: false,
      positionMs: 0,
      durationMs: 0,
      bufferedAheadMs: 0,
      loopMode: 'off',
      rate: 1,
      queueSize: 0,
      aheadCount: 0,
      restoring: false,
      foreground: false,
      skippedThisSession: 0,
    }),
    loadQueue: async () => ({ accepted: true, state: module.getState() }),
    patchQueue: async () => ({ accepted: true, revision: 0, stale: false }),
    play: () => {},
    pause: () => {},
    next: () => {},
    prev: () => {},
    seek: () => {},
    setLoop: () => {},
    setRate: () => {},
    setPolicy: () => {},
    stop: () => {},
  };

  function emit(name: string, payload: unknown) {
    listeners.get(name)?.forEach((listener) => listener(payload));
  }

  function setState(next: Partial<typeof state>) {
    state = { ...state, ...next };
  }

  function reset() {
    listeners.clear();
    calls.setLines.length = 0;
    calls.enabled.length = 0;
    calls.settingsOpened = 0;
    state = { enabled: false, permission: false, attached: false, touchable: false };
  }

  return { module, calls, emit, setState, reset };
});

vi.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'MPlayerNativePlayer' ? fake.module : null),
  requireNativeModule: (name: string) => {
    throw new Error(`native module ${name} is not available in tests`);
  },
}));

// 取词兜底副作用不参与本测试（只验宿主推送与可见性语义）
vi.mock('../services/audioPlayer', () => ({
  fetchLrcInBackground: vi.fn(async () => {}),
}));
// 其余模块级原生依赖（node 环境无原生链）
vi.mock('expo-audio', () => ({
  createAudioPlayer: () => ({
    addListener: () => ({ remove: () => {} }),
    play: () => {},
    pause: async () => {},
    remove: () => {},
    replace: () => {},
    seekTo: async () => {},
  }),
  setAudioModeAsync: async () => {},
}));
vi.mock('expo-constants', () => ({ AppOwnership: { Expo: 'expo' }, default: { appOwnership: null } }));
// cacheService → fileBackend 的磁盘后端（node 环境无 expo 原生模块）
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/mplayer-test/',
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => {},
  makeDirectoryAsync: async () => {},
  deleteAsync: async () => {},
  getInfoAsync: async () => ({ exists: false }),
}));

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function song(id: string, lrc: string, sourceType: Song['sourceType'] = 'netease'): Song {
  return { id, name: `song-${id}`, artist: 'artist', sourceType, lrc } as Song;
}

async function load() {
  vi.resetModules();
  const platform = await import('react-native');
  (platform.Platform as unknown as { Version: number }).Version = 34;
  const playerStore = await import('../stores/playerStore');
  const settingsStore = await import('../stores/settingsStore');
  const lyricsStore = await import('../stores/lyricsStore');
  const overlayStore = await import('../stores/lyricOverlayStore');
  const logsStore = await import('../stores/logsStore');
  const overlay = await import('../services/lyricOverlay');
  return { platform, playerStore, settingsStore, lyricsStore, overlayStore, logsStore, overlay };
}

beforeEach(() => {
  fake.reset();
});

describe('#775 浮窗开关意图与权限状态', () => {
  it('开关只持久化意图；无权限时不抛错、不建窗', async () => {
    const { overlay, settingsStore, overlayStore } = await load();
    fake.setState({ permission: false, attached: false });
    overlay.initLyricOverlay();

    expect(() => overlay.setLyricOverlayEnabled(true)).not.toThrow();
    expect(settingsStore.useSettingsStore.getState().floatingLyricsEnabled).toBe(true);
    expect(fake.calls.enabled.at(-1)).toBe(true);
    expect(overlayStore.useLyricOverlayStore.getState().permission).toBe(false);
    expect(overlayStore.useLyricOverlayStore.getState().attached).toBe(false);
  });

  it('关闭开关立即回灌原生并保持关闭', async () => {
    const { overlay, settingsStore } = await load();
    overlay.initLyricOverlay();
    overlay.setLyricOverlayEnabled(true);
    overlay.setLyricOverlayEnabled(false);
    expect(settingsStore.useSettingsStore.getState().floatingLyricsEnabled).toBe(false);
    expect(fake.calls.enabled.at(-1)).toBe(false);
  });

  it('API < 26 不支持浮窗（入口隐藏依据）', async () => {
    const { overlay, platform } = await load();
    (platform.Platform as unknown as { Version: number }).Version = 25;
    expect(overlay.isLyricOverlaySupported()).toBe(false);
    (platform.Platform as unknown as { Version: number }).Version = 34;
    expect(overlay.isLyricOverlaySupported()).toBe(true);
  });

  it('权限撤销事件：attached 落 false、开关保持 on、一次性提示', async () => {
    const { overlay, overlayStore, logsStore, settingsStore } = await load();
    overlay.initLyricOverlay();
    overlay.setLyricOverlayEnabled(true);
    expect(settingsStore.useSettingsStore.getState().floatingLyricsEnabled).toBe(true);
    fake.emit('lyricOverlayState', { enabled: true, permission: true, attached: true, touchable: true });
    expect(overlayStore.useLyricOverlayStore.getState().attached).toBe(true);

    fake.emit('lyricOverlayState', { enabled: true, permission: false, attached: false, touchable: false });
    const state = overlayStore.useLyricOverlayStore.getState();
    expect(state.permission).toBe(false);
    expect(state.attached).toBe(false);
    expect(logsStore.useLogsStore.getState().notice?.text).toContain('权限');

    // 第二次撤销事件不再重复提示
    logsStore.useLogsStore.getState().clearNotice();
    fake.emit('lyricOverlayState', { enabled: true, permission: false, attached: false, touchable: false });
    expect(logsStore.useLogsStore.getState().notice).toBeNull();
  });
});

describe('#775 JS 歌词推送器（宿主级）', () => {
  it('歌词就绪推送整张 {time,text} 表', async () => {
    const { overlay, playerStore, lyricsStore, settingsStore } = await load();
    settingsStore.useSettingsStore.setState({ floatingLyricsEnabled: true });
    lyricsStore.initLyricsHost();
    overlay.initLyricOverlay();

    const a = song('A', '[00:01.00]hello\n[00:03.50]world');
    playerStore.usePlayerStore.setState({ currentSong: a, queue: [a], currentIndex: 0 });
    await flush();

    const last = fake.calls.setLines.at(-1);
    expect(last?.trackKey).toBe('A');
    expect(last?.lines).toEqual([
      { time: 1, text: 'hello' },
      { time: 3.5, text: 'world' },
    ]);
  });

  it('切曲先清旧表（新词未就绪不残留上一首）', async () => {
    const { overlay, playerStore, lyricsStore, settingsStore } = await load();
    settingsStore.useSettingsStore.setState({ floatingLyricsEnabled: true });
    lyricsStore.initLyricsHost();
    overlay.initLyricOverlay();

    const a = song('A', '[00:01.00]hello');
    playerStore.usePlayerStore.setState({ currentSong: a, queue: [a], currentIndex: 0 });
    await flush();

    fake.calls.setLines.length = 0;
    const b = song('B', '', 'local');
    playerStore.usePlayerStore.setState({ currentSong: b, queue: [b], currentIndex: 0 });
    expect(fake.calls.setLines[0]).toEqual({ trackKey: 'B', lines: [] });
    await flush();
  });

  it('空词 / 纯音乐推送空表（原生据此隐藏）', async () => {
    const { overlay, playerStore, lyricsStore, settingsStore } = await load();
    settingsStore.useSettingsStore.setState({ floatingLyricsEnabled: true });
    lyricsStore.initLyricsHost();
    overlay.initLyricOverlay();

    const local = song('L', '', 'local');
    playerStore.usePlayerStore.setState({ currentSong: local, queue: [local], currentIndex: 0 });
    await flush();

    const last = fake.calls.setLines.at(-1);
    expect(last).toEqual({ trackKey: 'L', lines: [] });
  });

  it('serviceState 变化（服务重启）重灌意图并重推当前表', async () => {
    const { overlay, playerStore, lyricsStore, settingsStore } = await load();
    settingsStore.useSettingsStore.setState({ floatingLyricsEnabled: true });
    lyricsStore.initLyricsHost();
    overlay.initLyricOverlay();

    const a = song('A', '[00:02.00]line');
    playerStore.usePlayerStore.setState({ currentSong: a, queue: [a], currentIndex: 0 });
    await flush();

    fake.calls.setLines.length = 0;
    fake.calls.enabled.length = 0;
    fake.emit('serviceState', { foreground: true, restoring: false });
    await flush();

    expect(fake.calls.enabled.at(-1)).toBe(true);
    expect(fake.calls.setLines.at(-1)).toEqual({
      trackKey: 'A',
      lines: [{ time: 2, text: 'line' }],
    });
  });
});

describe('#775 取词宿主（供浮窗与全屏播放器共用）', () => {
  it('切歌立即清旧词，新词到达后替换', async () => {
    const { lyricsStore } = await load();
    const a = song('A', '[00:01.00]hello');
    lyricsStore.useLyricsStore.getState().loadForSong(a);
    await flush();
    expect(lyricsStore.useLyricsStore.getState().lines.map((l) => l.text)).toEqual(['hello']);

    const b = song('B', '[00:05.00]second');
    lyricsStore.useLyricsStore.getState().loadForSong(b);
    expect(lyricsStore.useLyricsStore.getState().lines).toEqual([]);
    await flush();
    expect(lyricsStore.useLyricsStore.getState().lines).toEqual([{ time: 5, text: 'second' }]);
  });

  it('会话缓存命中不重复解析', async () => {
    const { lyricsStore } = await load();
    const a = song('A', '[00:01.00]hello');
    lyricsStore.useLyricsStore.getState().loadForSong(a);
    await flush();
    const first = lyricsStore.useLyricsStore.getState().lines;

    lyricsStore.useLyricsStore.getState().loadForSong(a);
    expect(lyricsStore.useLyricsStore.getState().lines).toBe(first);
    expect(lyricsStore.useLyricsStore.getState().loading).toBe(false);
  });

  it('无词歌曲加载结束为空表且不显示占位', async () => {
    const { lyricsStore } = await load();
    const local = song('L', '', 'local');
    lyricsStore.useLyricsStore.getState().loadForSong(local);
    await flush();
    expect(lyricsStore.useLyricsStore.getState().lines).toEqual([]);
    expect(lyricsStore.useLyricsStore.getState().loading).toBe(false);
  });
});
