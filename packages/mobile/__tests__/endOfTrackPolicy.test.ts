/**
 * #666 曲末策略表（下推面）：判定在 core，JS 只在补窗轮把表算好下发。
 * 契约 CONTRACT-666.md §5；setup.ts 把原生桥打成 null，本文件覆盖成假原生模块。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Policy } from '../modules/native-player';
import type { Song } from '@mplayer/core';

const fake = vi.hoisted(() => {
  type FakeTrack = { key: string; songId: string };
  type PatchInput = {
    baseRevision: number;
    append?: { songId: string; meta: { key: string } }[];
    outcome?: 'grown' | 'deduped' | 'empty';
  };
  const state = { revision: 5, index: 0, key: null as string | null, tracks: [] as FakeTrack[] };
  const patchCalls: PatchInput[] = [];
  const policyCalls: Policy[] = [];
  /** 注入跨端调用失败：>0 时下一次 setPolicy 抛错（模拟桥暂时不可用） */
  const faults = { policyThrows: 0 };
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
    loadQueue: async () => ({ accepted: true, state: module.getState() }),
    patchQueue: async (input: PatchInput) => {
      patchCalls.push(input);
      for (const track of input.append ?? []) {
        if (!state.tracks.some((t) => t.key === track.meta.key)) {
          state.tracks.push({ key: track.meta.key, songId: track.songId });
        }
      }
      return { accepted: true, revision: state.revision, stale: false };
    },
    play: () => {},
    pause: () => {},
    next: () => {},
    prev: () => {},
    seek: () => {},
    setLoop: () => {},
    setRate: () => {},
    setPolicy: (policy: Policy) => {
      if (faults.policyThrows > 0) {
        faults.policyThrows -= 1;
        throw new Error('bridge down');
      }
      policyCalls.push(policy);
    },
    stop: () => {},
    addListener: () => ({ remove: () => {} }),
  };
  return { state, patchCalls, policyCalls, faults, module };
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

import { DEFAULT_POLICY } from '../modules/native-player';
import { feedWindow, nativeStop } from '../services/nativePlayer';
import { resetPrefetchState, prefetchKey } from '../services/queuePrefetch';
import { usePlayerStore } from '../stores/playerStore';
import { useSettingsStore } from '../stores/settingsStore';

function song(id: string): Song {
  return { id, name: 'song-' + id, artist: 'artist', sourceType: 'netease' } as Song;
}

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

function setNative(ids: string[], index: number): void {
  fake.state.tracks = ids.map((id) => ({ key: prefetchKey(song(id)), songId: id }));
  fake.state.index = index;
  fake.state.key = prefetchKey(song(ids[index]));
}

function lastTable() {
  return fake.policyCalls.at(-1)?.endOfTrack;
}

beforeEach(() => {
  resetPrefetchState();
  nativeStop();
  resolution.resolvePlayableUrlMobile.mockClear();
  fake.patchCalls.length = 0;
  fake.policyCalls.length = 0;
  fake.faults.policyThrows = 0;
  fake.state.revision = 5;
  fake.state.tracks = [];
  fake.state.index = 0;
  fake.state.key = null;
  usePlayerStore.setState({ queue: [], currentSong: null, currentIndex: -1, hasPlayed: false, shuffle: null });
  useSettingsStore.setState({ playMode: '列表循环' });
});

describe('#666 曲末表下推：随机到末位才 hold', () => {
  it('随机停在序列末位 + 本轮零新增（deduped）→ atWindowTail=hold', async () => {
    setQueue(['A', 'B', 'C'], 2); // 当前曲 C
    useSettingsStore.setState({ playMode: '随机播放' });
    // 序列 [B, A, C]：C 排在末位，游标 2 = 到头
    usePlayerStore.setState({ shuffle: { order: ['B', 'A', 'C'], cursor: 2 } });
    // 原生窗口已含全部三首 → 本轮补窗全被去重（outcome=deduped）
    setNative(['A', 'B', 'C'], 2);

    await feedWindow(undefined, 'hole');

    expect(fake.patchCalls.at(-1)?.outcome).toBe('deduped');
    expect(lastTable()).toEqual({
      restartOnSingle: false,
      advanceWithinWindow: true,
      atWindowTail: 'hold',
      shuffleEndPolicy: 'stop',
    });
  });

  it('随机未到末位 → atWindowTail=ask-js（补窗照常问 JS）', async () => {
    setQueue(['A', 'B', 'C'], 0); // 当前曲 A
    useSettingsStore.setState({ playMode: '随机播放' });
    // 序列 [C, A, B]：A 在中间，后面还有 B
    usePlayerStore.setState({ shuffle: { order: ['C', 'A', 'B'], cursor: 1 } });
    setNative(['A', 'B'], 0);

    await feedWindow(2);

    expect(lastTable()?.atWindowTail).toBe('ask-js');
    expect(lastTable()?.shuffleEndPolicy).toBe('stop');
  });

  it('序列末位但本轮补进了新项（grown）→ 仍 ask-js（饱和态是 hold 的硬前置）', async () => {
    setQueue(['A', 'B', 'C'], 2);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['B', 'A', 'C'], cursor: 2 } });
    // 原生只有当前曲 C → 本轮补进 B/A，outcome=grown
    setNative(['C'], 0);

    await feedWindow(2);

    expect(fake.patchCalls.at(-1)?.outcome).toBe('grown');
    expect(lastTable()?.atWindowTail).toBe('ask-js');
  });

  it('表没变就不重复下发（稳态两轮只 setPolicy 一次）', async () => {
    setQueue(['A', 'B', 'C'], 2);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['B', 'A', 'C'], cursor: 2 } });
    setNative(['A', 'B', 'C'], 2);

    await feedWindow(undefined, 'hole');
    expect(fake.policyCalls).toHaveLength(1);
    await feedWindow(undefined, 'hole');
    expect(fake.policyCalls).toHaveLength(1);
  });

  it('setPolicy 抛错不记账：下一轮仍重发同一份表（去抖不能把没落地的值钉住）', async () => {
    setQueue(['A', 'B', 'C'], 2);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['B', 'A', 'C'], cursor: 2 } });
    setNative(['A', 'B', 'C'], 2);

    fake.faults.policyThrows = 1;
    await feedWindow(undefined, 'hole');
    expect(fake.policyCalls).toHaveLength(0);

    await feedWindow(undefined, 'hole');
    expect(fake.policyCalls).toHaveLength(1);
    expect(fake.policyCalls[0].endOfTrack?.atWindowTail).toBe('hold');
  });

  it('单曲循环 → restartOnSingle=true（窗口尾仍 ask-js，曲末重播自己）', async () => {
    setQueue(['A', 'B'], 0);
    useSettingsStore.setState({ playMode: '单曲循环' });
    setNative(['A', 'B'], 0);

    await feedWindow(1);

    expect(lastTable()).toEqual({
      restartOnSingle: true,
      advanceWithinWindow: true,
      atWindowTail: 'ask-js',
      shuffleEndPolicy: 'stop',
    });
  });
});

describe('#666 缺表兜底是默认路径', () => {
  it('DEFAULT_POLICY.endOfTrack === null（冷启 / 老版 JS → 原生内联兜底）', () => {
    expect(DEFAULT_POLICY.endOfTrack).toBeNull();
  });
});
