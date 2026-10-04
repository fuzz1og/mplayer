/**
 * #555：**原生引擎路径**的 next/prev 落点必须由 core planAdvance 决定。
 *
 * 修前（本文件建立时）：
 * - nativeNext 从不调 planAdvance，直接 NP.next()（原生顺序推进）；
 * - nativePrev 只有随机支走 advance(-1)，顺序支仍 NP.prev()。
 * 于是「移动 next/prev 由 planAdvance 决定落点」这条验收在 Android 主路径上不成立。
 *
 * 这里用假原生模块把两条真实产线分支钉住：
 * ① 原生窗口的相邻格 == core 落点 → 交原生顺序推进（不重载，稳态快路径）；
 * ② 原生窗口的相邻格 ≠ core 落点（队首回绕 / 窗口分叉 / 单曲循环）→ 按 core effect 交付。
 * setup.ts 全局把 requireOptionalNativeModule 打成 null，本文件覆盖成假原生模块。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';

const fake = vi.hoisted(() => {
  type FakeTrack = { key: string; songId: string };
  type LoadInput = {
    revision: number;
    tracks: { songId: string; meta: { key: string } }[];
    startIndex: number;
    playWhenReady: boolean;
  };
  type PatchInput = {
    baseRevision: number;
    append?: { songId: string; meta: { key: string } }[];
    upsert?: { songId: string; meta: { key: string } }[];
    insertAfterCurrent?: { songId: string; meta: { key: string } };
  };
  const state = { revision: 5, index: 0, key: null as string | null, tracks: [] as FakeTrack[] };
  const loadQueueCalls: LoadInput[] = [];
  const patchCalls: PatchInput[] = [];
  const nextCalls: number[] = [];
  const prevCalls: number[] = [];
  const seekCalls: number[] = [];
  const playCalls: number[] = [];
  const module = {
    registerHeadlessHost: () => true,
    isServiceRunning: () => true,
    getState: () => ({
      revision: state.revision,
      index: state.index,
      key: state.key,
      tracks: state.tracks.map((t) => ({ ...t })),
      playing: false,
      playWhenReady: false,
      positionMs: 0,
      durationMs: 0,
      bufferedAheadMs: 0,
      loopMode: 'all' as const,
      rate: 1,
      queueSize: state.tracks.length,
      aheadCount: 0,
      restoring: false,
      foreground: false,
      skippedThisSession: 0,
    }),
    loadQueue: async (input: LoadInput) => {
      loadQueueCalls.push(input);
      return { accepted: true, state: module.getState() };
    },
    patchQueue: async (input: PatchInput) => {
      patchCalls.push(input);
      return { accepted: true, revision: state.revision, stale: false };
    },
    play: () => {
      playCalls.push(1);
    },
    pause: () => {},
    next: () => {
      nextCalls.push(1);
    },
    prev: () => {
      prevCalls.push(1);
    },
    seek: (seconds: number) => {
      seekCalls.push(seconds);
    },
    setLoop: () => {},
    setRate: () => {},
    setPolicy: () => {},
    stop: () => {},
    addListener: () => ({ remove: () => {} }),
  };
  return { state, loadQueueCalls, patchCalls, nextCalls, prevCalls, seekCalls, playCalls, module };
});

vi.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'MPlayerNativePlayer' ? fake.module : null),
  requireNativeModule: (name: string) => {
    throw new Error('native module ' + name + ' is not available in tests');
  },
}));

const resolution = vi.hoisted(() => ({
  resolvePlayableUrlMobile: vi.fn(async (s: { id: string }) => ({
    url: 'https://cdn.example.com/' + s.id + '.mp3',
    nonFull: false,
  })),
}));
vi.mock('../services/songResolution', () => ({
  resolvePlayableUrlMobile: resolution.resolvePlayableUrlMobile,
}));
vi.mock('../services/cacheService', () => ({
  getCachedResource: async () => null,
  setCachedResource: async () => {},
  urlAgeMs: () => null,
}));

import { nativeNext, nativePrev } from '../services/nativePlayer';
import { prefetchKey } from '../services/queuePrefetch';
import { usePlayerStore } from '../stores/playerStore';
import { useSettingsStore } from '../stores/settingsStore';

function song(id: string): Song {
  return { id, name: 'song-' + id, artist: 'artist', sourceType: 'netease' } as Song;
}

/** 让 void nativePlaySong() 这类 fire-and-forget 的微任务跑完 */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/** JS 侧完整队列（原生只是它的预取窗口） */
function setQueue(ids: string[], currentIndex: number): Song[] {
  const queue = ids.map(song);
  usePlayerStore.setState({
    queue,
    currentSong: queue[currentIndex] ?? null,
    currentIndex,
    hasPlayed: true,
  });
  return queue;
}

/** 原生权威窗口（顺序由 JS 的补窗喂出来） */
function setNative(ids: string[], index: number): void {
  fake.state.tracks = ids.map((id) => ({ key: prefetchKey(song(id)), songId: id }));
  fake.state.index = index;
  fake.state.key = prefetchKey(song(ids[index]));
}

function lastLoadIds(): string[] | undefined {
  return fake.loadQueueCalls.at(-1)?.tracks.map((t) => t.songId);
}

beforeEach(() => {
  fake.loadQueueCalls.length = 0;
  fake.patchCalls.length = 0;
  fake.nextCalls.length = 0;
  fake.prevCalls.length = 0;
  fake.seekCalls.length = 0;
  fake.playCalls.length = 0;
  fake.state.revision = 5;
  fake.state.tracks = [];
  fake.state.index = 0;
  fake.state.key = null;
  usePlayerStore.setState({ queue: [], currentSong: null, currentIndex: -1, hasPlayed: false, shuffle: null });
  useSettingsStore.setState({ playMode: '列表循环' });
});

describe('#555 原生路径的落点由 core planAdvance 决定', () => {
  it('随机模式：原生窗口下一格 ≠ core 落点时，next 起播 core 的落点曲', async () => {
    setQueue(['A', 'B', 'C'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    // 随机序 A→C→B：core next 从 A 落到 C（成员下标 2）
    usePlayerStore.setState({ shuffle: { order: ['A', 'C', 'B'], cursor: 0 } });
    // 原生窗口是 [A, B]：顺序推进只会落到 B，与 core 落点不同
    setNative(['A', 'B'], 0);

    nativeNext();
    await flush();

    expect(lastLoadIds()).toEqual(['C']);
    expect(fake.nextCalls).toHaveLength(0);
    expect(usePlayerStore.getState().currentSong?.id).toBe('C');
  });

  it('列表循环：首曲按上一首回绕到队尾（原生在队首没有上一格）', async () => {
    setQueue(['A', 'B', 'C'], 0);
    useSettingsStore.setState({ playMode: '列表循环' });
    setNative(['A', 'B', 'C'], 0);

    nativePrev();
    await flush();

    // core planAdvance 在列表循环下回绕到队尾 C
    expect(lastLoadIds()).toEqual(['C']);
    expect(fake.prevCalls).toHaveLength(0);
  });

  it('列表循环：原生窗口相邻格 == core 落点时，next 交原生顺序推进（不重载）', () => {
    setQueue(['A', 'B', 'C'], 0);
    useSettingsStore.setState({ playMode: '列表循环' });
    setNative(['A', 'B', 'C'], 0);

    nativeNext();

    expect(fake.nextCalls).toHaveLength(1);
    expect(fake.loadQueueCalls).toHaveLength(0);
  });

  it('随机模式：原生窗口相邻格 == 序列落点时，prev 交原生顺序推进并后退游标', () => {
    setQueue(['A', 'B', 'C'], 1); // 当前 B
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['A', 'C', 'B'], cursor: 2 } });
    setNative(['C', 'B'], 1); // 原生 index-1 = C == 序列上一张

    nativePrev();

    expect(fake.prevCalls).toHaveLength(1);
    expect(fake.loadQueueCalls).toHaveLength(0);
    expect(usePlayerStore.getState().shuffle?.cursor).toBe(1);
  });

  it('单曲循环：next 执行 restart-current（seek 0 重播，不顺序推进）', () => {
    setQueue(['A', 'B'], 0);
    useSettingsStore.setState({ playMode: '单曲循环' });
    setNative(['A', 'B'], 0);

    nativeNext();

    expect(fake.seekCalls).toEqual([0]);
    expect(fake.playCalls).toHaveLength(1);
    expect(fake.nextCalls).toHaveLength(0);
  });
});
