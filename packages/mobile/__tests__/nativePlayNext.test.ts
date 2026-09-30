/**
 * 「下一首播放」原生路径的首份 JS 侧测试（#495）。
 *
 * ⚠️ `__tests__/setup.ts` 全局把 `requireOptionalNativeModule` 打成 null（= 回落引擎路径），
 * 所以既有全部测试跑的都是 expo-audio；这里在本文件里 `vi.mock('expo')` 覆盖成**假原生模块**，
 * 让「原生引擎」这条路径第一次被 JS 侧测试覆盖。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';
import type { PatchQueueResult } from '../modules/native-player';

// ── 假原生模块（在 vi.mock 之前用 hoisted 建好，避免提升导致的 TDZ） ──
const fake = vi.hoisted(() => {
  type FakeTrack = { key: string; songId: string };
  type PatchInput = {
    baseRevision: number;
    append?: { songId: string; meta: { key: string } }[];
    insertAfterCurrent?: { songId: string; meta: { key: string } };
  };
  const state = { revision: 5, index: 0, key: 'A' as string | null, tracks: [] as FakeTrack[] };
  const patchCalls: PatchInput[] = [];
  const forced: PatchQueueResult[] = [];
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
    // 忠实模拟原生 QueueStore.insertAfterCurrent + append 的语义，让镜像/窗口断言有意义
    patchQueue: async (input: PatchInput) => {
      patchCalls.push(input);
      const next = forced.shift();
      if (next) {
        if (next.stale) state.revision = next.revision;
        return next;
      }
      if (input.insertAfterCurrent) {
        const key = input.insertAfterCurrent.meta.key;
        const at = state.tracks.findIndex((t) => t.key === key);
        const queued = at >= 0;
        if (at === state.index || at === state.index + 1) {
          return { accepted: true, revision: state.revision, stale: false, changed: false, queued: true, moved: false };
        }
        if (at >= 0) state.tracks.splice(at, 1);
        state.tracks.splice(state.index + 1, 0, { key, songId: input.insertAfterCurrent.songId });
        state.revision += 1;
        return { accepted: true, revision: state.revision, stale: false, changed: true, queued, moved: at >= 0 };
      }
      let changed = false;
      for (const track of input.append ?? []) {
        if (!state.tracks.some((t) => t.key === track.meta.key)) {
          state.tracks.push({ key: track.meta.key, songId: track.songId });
          changed = true;
        }
      }
      if (changed) state.revision += 1;
      return { accepted: true, revision: state.revision, stale: false };
    },
    play: () => {},
    pause: () => {},
    next: () => {},
    prev: () => {},
    seek: () => {},
    setLoop: () => {},
    setRate: () => {},
    setPolicy: () => {},
    stop: () => {},
    addListener: () => ({ remove: () => {} }),
  };
  return { state, patchCalls, forced, module };
});

vi.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'MPlayerNativePlayer' ? fake.module : null),
  requireNativeModule: (name: string) => {
    throw new Error('native module ' + name + ' is not available in tests');
  },
}));

// 解析链隔离：本文件只关心「解析成功之后」的队列行为
const resolution = vi.hoisted(() => ({
  resolvePlayableUrlMobile: vi.fn(async (song: { id: string }) => ({
    url: 'https://cdn.example.com/' + song.id + '.mp3',
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

// `services/audioPlayer.ts` 的模块级依赖（引擎无关入口的派发测试要 import 它）
vi.mock('expo-audio', () => ({
  createAudioPlayer: () => ({
    addListener: () => ({ remove: () => {} }),
    play: () => {},
    pause: async () => {},
    remove: () => {},
    replace: () => {},
    seekTo: async () => {},
    setActiveForLockScreen: () => {},
    updateLockScreenMetadata: () => {},
  }),
  setAudioModeAsync: async () => {},
}));
vi.mock('expo-constants', () => ({ AppOwnership: { Expo: 'expo' }, default: { appOwnership: null } }));
vi.mock('../services/notificationService', () => ({
  updateNotification: async () => {},
  clearNotification: async () => {},
}));
vi.mock('../services/networkState', () => ({ isOffline: async () => false }));

import { feedWindow, nativePlayNext, nativeStop } from '../services/nativePlayer';
import { playNextInQueue } from '../services/audioPlayer';
import { planPlayNext } from '../services/queueInsert';
import { prefetchKey, resetPrefetchState } from '../services/queuePrefetch';
import { usePlayerStore } from '../stores/playerStore';
import { useSettingsStore } from '../stores/settingsStore';

function song(id: string, extra: Partial<Song> = {}): Song {
  return { id, name: 'song-' + id, artist: 'artist', sourceType: 'netease', ...extra } as Song;
}

/** 让 `void feedWindow()` 这类 fire-and-forget 的微任务跑完 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function setQueue(ids: string[], currentIndex: number): Song[] {
  const queue = ids.map((id) => song(id));
  usePlayerStore.setState({
    queue,
    currentSong: queue[currentIndex] ?? null,
    currentIndex,
    hasPlayed: true,
  });
  return queue;
}

beforeEach(() => {
  resetPrefetchState();
  nativeStop();
  fake.patchCalls.length = 0;
  fake.forced.length = 0;
  fake.state.revision = 5;
  fake.state.index = 0;
  fake.state.key = 'A';
  fake.state.tracks = [];
  usePlayerStore.setState({ queue: [], currentSong: null, currentIndex: -1, hasPlayed: false });
  useSettingsStore.setState({ playMode: '列表循环' });
});

describe('planPlayNext：唯一接缝（语义对齐桌面 #506）', () => {
  it('不在队列 → 插到当前曲之后，长度 +1', () => {
    const queue = [song('A'), song('B'), song('C')];
    const plan = planPlayNext(queue, 0, song('D'), '列表循环');
    expect(plan.sequence.map((s) => s.id)).toEqual(['A', 'D', 'B', 'C']);
    expect(plan.insertAt).toBe(1);
    expect(plan.alreadyInSequence).toBe(false);
    expect(plan.moved).toBe(false);
    expect(plan.noop).toBe(false);
  });

  it('已在队列 → **移动**（不复制、长度不变），且保留队列里那份 Song 对象', () => {
    const queue = [song('A'), song('B'), song('C', { cover: 'fresh-cover' })];
    const inQueue = queue[2];
    const plan = planPlayNext(queue, 0, song('C', { cover: 'stale-cover' }), '列表循环');
    expect(plan.sequence.map((s) => s.id)).toEqual(['A', 'C', 'B']);
    expect(plan.sequence.length).toBe(queue.length);
    expect(plan.alreadyInSequence).toBe(true);
    expect(plan.moved).toBe(true);
    // 用户点的可能来自刚刷新的列表：已在队列的语义是「挪位置」，不静默换元数据
    expect(plan.sequence[1]).toBe(inQueue);
    expect(plan.sequence[1].cover).toBe('fresh-cover');
  });

  it('摘掉的那首在目标位之前 → 插入点随之 -1（顺序不错位）', () => {
    const queue = [song('A'), song('B'), song('C'), song('D')];
    const plan = planPlayNext(queue, 2, song('A'), '列表循环');
    expect(plan.sequence.map((s) => s.id)).toEqual(['B', 'C', 'A', 'D']);
  });

  it('已在「当前曲之后」这一位 → noop：连点两次结果稳定、队列逐项相同', () => {
    const queue = [song('A'), song('B'), song('C')];
    const plan = planPlayNext(queue, 0, song('B'), '列表循环');
    expect(plan.noop).toBe(true);
    expect(plan.moved).toBe(false);
    expect(plan.sequence.map((s) => s.id)).toEqual(['A', 'B', 'C']);
  });

  it('点的是当前曲 → noop（不移到「下一首」位置）', () => {
    const queue = [song('A'), song('B')];
    expect(planPlayNext(queue, 0, song('A'), '列表循环').noop).toBe(true);
  });

  it('当前曲是最后一首 → 插到队尾，不越界', () => {
    const queue = [song('A'), song('B')];
    expect(planPlayNext(queue, 1, song('C'), '列表循环').sequence.map((s) => s.id)).toEqual(['A', 'B', 'C']);
  });

  it('随机播放暂按顺序路径（随机语义待 Lead 结论，接缝只此一处）', () => {
    const plan = planPlayNext([song('A'), song('B'), song('C')], 0, song('C'), '随机播放');
    expect(plan.sequence.map((s) => s.id)).toEqual(['A', 'C', 'B']);
  });
});

describe('playerStore.insertNext：iOS / 回落引擎（队列 100% 在 JS）', () => {
  it('队列为空 → 设为当前曲并 started（等价「开始播放这首」，桌面 #506 同口径）', () => {
    const result = usePlayerStore.getState().insertNext(song('A'));
    expect(result.started).toBe(true);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['A']);
    expect(usePlayerStore.getState().currentSong?.id).toBe('A');
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it('插到 currentIndex+1，当前曲不动', () => {
    setQueue(['A', 'B', 'C'], 0);
    const result = usePlayerStore.getState().insertNext(song('C'));
    expect(result.started).toBe(false);
    expect(result.moved).toBe(true);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['A', 'C', 'B']);
    expect(usePlayerStore.getState().currentSong?.id).toBe('A');
  });

  it('连点两次幂等：第二次 noop，队列逐项相同', () => {
    setQueue(['A', 'B', 'C'], 0);
    usePlayerStore.getState().insertNext(song('C'));
    const first = usePlayerStore.getState().queue.map((s) => s.id);
    const second = usePlayerStore.getState().insertNext(song('C'));
    expect(second.noop).toBe(true);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(first);
  });

  it('移动后 currentIndex 仍指向同一首（`next()` 语义不被插队破坏）', () => {
    setQueue(['A', 'B', 'C'], 1);
    usePlayerStore.getState().insertNext(song('C'));
    expect(usePlayerStore.getState().currentSong?.id).toBe('B');
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().currentIndex].id).toBe('B');
  });
});

describe('nativePlayNext：原生桥（#495）', () => {
  it('把 insertAfterCurrent 投给桥，并带当前 revision', async () => {
    setQueue(['A', 'B', 'C'], 0);
    fake.state.tracks = [{ key: prefetchKey(song('A')), songId: 'A' }];
    const result = await nativePlayNext(song('C'));
    expect(result.queued).toBe(true);
    expect(fake.patchCalls).toHaveLength(1);
    expect(fake.patchCalls[0].baseRevision).toBe(5);
    expect(fake.patchCalls[0].insertAfterCurrent?.meta.key).toBe(prefetchKey(song('C')));
    // 原生顺序变成 [A, C, ...]
    expect(fake.state.tracks.map((t) => t.key)).toEqual(['A', 'C']);
  });

  it('已在原生队列 → 移动语义（不产生重复条目）', async () => {
    setQueue(['A', 'B', 'C'], 0);
    fake.state.tracks = [
      { key: prefetchKey(song('A')), songId: 'A' },
      { key: prefetchKey(song('B')), songId: 'B' },
      { key: prefetchKey(song('C')), songId: 'C' },
    ];
    const result = await nativePlayNext(song('C'));
    expect(result.queued).toBe(true);
    expect(result.moved).toBe(true);
    expect(fake.state.tracks.map((t) => t.key)).toEqual([
      prefetchKey(song('A')),
      prefetchKey(song('C')),
      prefetchKey(song('B')),
    ]);
  });

  it('stale → 重读 revision 重试一次（用户点了就要落地，不等下一轮水位事件）', async () => {
    setQueue(['A', 'B', 'C'], 0);
    fake.state.tracks = [{ key: prefetchKey(song('A')), songId: 'A' }];
    fake.forced.push({ accepted: false, revision: 99, stale: true });
    const result = await nativePlayNext(song('C'));
    expect(fake.patchCalls).toHaveLength(2);
    expect(fake.patchCalls[0].baseRevision).toBe(5);
    expect(fake.patchCalls[1].baseRevision).toBe(99);
    expect(result.queued).toBe(true);
  });

  it('桥回 accepted=false + error → 返回可观测失败，绝不静默', async () => {
    setQueue(['A', 'B', 'C'], 0);
    fake.forced.push({ accepted: false, revision: 5, stale: false, error: 'unsupported' });
    const result = await nativePlayNext(song('C'));
    expect(result.queued).toBe(false);
    expect(result.reason).toBe('unsupported');
  });

  it('解析不到直链 → 可观测失败（不产生桥调用）', async () => {
    setQueue(['A', 'B', 'C'], 0);
    resolution.resolvePlayableUrlMobile.mockResolvedValueOnce({ url: '', nonFull: false } as never);
    const result = await nativePlayNext(song('C'));
    expect(result.queued).toBe(false);
    expect(result.reason).toBe('failed');
    expect(fake.patchCalls).toHaveLength(0);
  });
});

describe('插队后的补窗窗口（#495 第 3 条的静默失效面）', () => {
  it('被插队挤到 index+2 的那首**不重复喂、不漏喂**', async () => {
    const queue = setQueue(['A', 'B', 'C', 'D'], 0);
    fake.state.tracks = [
      { key: prefetchKey(queue[0]), songId: 'A' },
      { key: prefetchKey(queue[1]), songId: 'B' },
    ];
    await nativePlayNext(song('C'));
    // nativePlayNext 末尾 `void feedWindow()`：等补窗那一轮投喂落地
    await vi.waitFor(() => expect(fake.patchCalls.length).toBeGreaterThanOrEqual(2));
    await flush();

    // 第 1 次是插队本身（没有 append），第 2 次是紧随其后的补窗
    expect(fake.patchCalls[0].insertAfterCurrent?.meta.key).toBe(prefetchKey(song('C')));
    const appended = (fake.patchCalls[1]?.append ?? []).map((t) => t.meta.key);
    // 原生此刻是 [A, C, B]：C（插队歌）与 B（被挤到 index+2）都已在原生窗口里 → 不重复喂；
    // 只补真正缺的那首 D。旧实现把「全镜像 key」当已投喂，连续插队后窗口会逐次塌陷。
    expect(appended).toEqual([prefetchKey(song('D'))]);
    expect(fake.state.tracks.map((t) => t.key)).toEqual([
      prefetchKey(song('A')),
      prefetchKey(song('C')),
      prefetchKey(song('B')),
      prefetchKey(song('D')),
    ]);
  });

  it('窗口绕回队首时，已在镜像里但**排在当前曲之前**的 key 不该被当「已投喂」（位置感知）', async () => {
    const queue = setQueue(['A', 'B', 'C'], 2);
    // 原生快照里含历史（当前曲 C 之前还有 A/B）；旧实现把这些历史也算「已投喂」
    fake.state.tracks = queue.map((s) => ({ key: prefetchKey(s), songId: s.id }));
    fake.state.index = 2;
    fake.state.key = prefetchKey(song('C'));
    await feedWindow(3);
    const appended = (fake.patchCalls[0]?.append ?? []).map((t) => t.meta.key);
    // 旧实现用「与位置无关的 key 集合」→ A/B 被当已投喂，绕回队首时窗口整个空掉；
    // 按原生当前位置切片后，A/B 重新成为候选（绕回队首续队列）。
    expect(appended).toEqual([prefetchKey(song('A')), prefetchKey(song('B'))]);
  });
});

describe('playNextInQueue：引擎无关入口（#495）', () => {
  it('原生引擎：不先动 JS 队列；桥报错时队列保持原样（原生的权威性不被乐观写破坏）', async () => {
    setQueue(['A', 'B', 'C'], 0);
    fake.state.tracks = [{ key: prefetchKey(song('A')), songId: 'A' }];
    fake.forced.push({ accepted: false, revision: 5, stale: false, error: 'unsupported' });
    const outcome = await playNextInQueue(song('C'));
    expect(outcome.queued).toBe(false);
    expect(outcome.reason).toBe('unsupported');
    // 失败时 JS 队列必须一字不改（否则 UI 会显示一首原生根本没有的「下一首」）
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['A', 'B', 'C']);
  });

  it('原生引擎：成功后按原生顺序**强制**重建 JS 队列（移动分支长度不变但顺序变了）', async () => {
    setQueue(['A', 'B', 'C'], 0);
    fake.state.tracks = [
      { key: prefetchKey(song('A')), songId: 'A' },
      { key: prefetchKey(song('B')), songId: 'B' },
      { key: prefetchKey(song('C')), songId: 'C' },
    ];
    const outcome = await playNextInQueue(song('C'));
    expect(outcome.queued).toBe(true);
    expect(outcome.moved).toBe(true);
    // 原生 [A, C, B] → JS 队列必须逐项一致（默认对账在长度相同时会跳过）
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['A', 'C', 'B']);
    expect(usePlayerStore.getState().currentSong?.id).toBe('A');
  });
});
