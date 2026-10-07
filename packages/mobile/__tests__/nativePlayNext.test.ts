/**
 * 「下一首播放」原生路径的首份 JS 侧测试（#495）。
 *
 * ⚠️ `__tests__/setup.ts` 全局把 `requireOptionalNativeModule` 打成 null（= 回落引擎路径），
 * 所以既有全部测试跑的都是 expo-audio；这里在本文件里 `vi.mock('expo')` 覆盖成**假原生模块**，
 * 让「原生引擎」这条路径第一次被 JS 侧测试覆盖。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    outcome?: 'grown' | 'deduped' | 'empty';
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
// 换源效果（songActionEffects）的模块级依赖：本文件只验「换源怎么落到随机序」，
// 下载/路由/搜索都替身掉（否则 expo-file-system / expo-router 在 node 环境里拖不进来）。
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('../services/downloadService', () => ({ downloadSong: vi.fn(async () => {}) }));
vi.mock('../services/sourceSwap', () => ({
  applySwap: vi.fn(async () => null),
  searchSwapCandidates: vi.fn(async () => []),
}));

import { feedWindow, nativePlayNext, nativeStop } from '../services/nativePlayer';
import { playNextInQueue } from '../services/audioPlayer';
import { planPlayNext } from '../services/queueInsert';
import { nativeSongActionEffects } from '../services/songActionEffects';
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

  it('原生引擎：成功后 JS 队列就地同步（不重建、不缩成原生窗口）', async () => {
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

/**
 * #518 的失败用例：真机现场「设为下一首的歌没有被播」。
 *
 * 现场三件事必须都在测试里钉住：
 * ① 原生只持**预取窗口**（loadQueue 一首 + 补窗追加），JS 队列才是完整歌单；
 * ② 插队成功后**不得**用原生窗口重建 JS 队列（那会把歌单缩成几首窗口歌，并让补窗基准
 *    从「歌单下标」跳成「窗口下标」——真机 `计划=[28,29,30]` ↔ `计划=[0]` 反复横跳）；
 * ③ 原生桥没报插队语义（老 APK / 未重编译原生）时，必须回**可观测失败**，
 *    不能因为 `accepted=true` 就提示「已设为下一首」（真机日志实锤的那条）。
 */
describe('#518：插入后「下一首」= 被插入的那首；补窗基准不回跳', () => {
  /** 原生推进 = index+1（PlayerService.next → seekToNextMediaItem），故「下一首」= index+1 */
  function nativeNextId(): string | undefined {
    return fake.state.tracks[fake.state.index + 1]?.songId;
  }

  function appendedKeys(): string[] {
    return fake.patchCalls.flatMap((call) => (call.append ?? []).map((t) => t.meta.key));
  }

  /** 原生窗口只有 [C, D, E]（当前曲 + 补窗两首），JS 队列是七首完整歌单 */
  function longQueueWithShortNativeWindow(): void {
    setQueue(['A', 'B', 'C', 'D', 'E', 'F', 'H'], 2);
    fake.state.tracks = ['C', 'D', 'E'].map((id) => ({ key: prefetchKey(song(id)), songId: id }));
    fake.state.index = 0;
    fake.state.key = prefetchKey(song('C'));
  }

  it('原生只持窗口 → 插队后 JS 队列不被缩成窗口，当前曲位置不动、下一首是 G', async () => {
    longQueueWithShortNativeWindow();

    const outcome = await playNextInQueue(song('G'));
    await flush();

    expect(outcome.queued).toBe(true);
    // ① 原生推进的下一格就是被插入的 G（不是补窗喂进去的窗口歌）
    expect(nativeNextId()).toBe('G');
    // ② JS 队列仍是完整歌单，G 落在当前曲之后；当前曲与下标都不因插队而跳
    const state = usePlayerStore.getState();
    expect(state.queue.map((s) => s.id)).toEqual(['A', 'B', 'C', 'G', 'D', 'E', 'F', 'H']);
    expect(state.currentSong?.id).toBe('C');
    expect(state.currentIndex).toBe(2);
    expect(state.queue[state.currentIndex + 1]?.id).toBe('G');
  });

  it('插队后继续补窗：基准仍是完整歌单的当前曲，不回跳到窗口下标/队首', async () => {
    longQueueWithShortNativeWindow();
    await playNextInQueue(song('G'));
    await flush();

    // 只考察「插队之后的那一轮补窗」：基准若被换成原生窗口 [C,G,D,E]，
    // 这里会因为「窗口里的歌都已在原生手里」而一个候选都算不出来（→ []）。
    fake.patchCalls.length = 0;
    await feedWindow(3);

    const keys = appendedKeys();
    expect(keys.length).toBeGreaterThan(0);
    // 紧接当前曲（歌单第 3 首 C）之后、还没进原生的第一首 = F
    expect(keys[0]).toBe(prefetchKey(song('F')));
    // 被插入的 G 已在原生手里 → 绝不重复喂
    expect(keys).not.toContain(prefetchKey(song('G')));
  });

  it('解析期间 JS 队列基准被整体替换 → 这一轮补窗必须丢弃（不按旧基准投喂）', async () => {
    setQueue(['A', 'B', 'C', 'D'], 0);
    fake.state.tracks = [{ key: prefetchKey(song('A')), songId: 'A' }];
    fake.state.index = 0;
    fake.state.key = prefetchKey(song('A'));

    let release!: () => void;
    resolution.resolvePlayableUrlMobile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ url: 'https://cdn.example.com/B.mp3', nonFull: false });
        })
    );

    const round = feedWindow(1); // 此刻基于 [A,B,C,D] 计划出 B
    await flush();
    setQueue(['A', 'Z', 'C', 'D'], 0); // 基准被整体替换（新数组）
    release();
    await round;

    // 旧基准算出来的 B 不得落地：它既不在新队列的「当前曲之后」，还会把原生窗口带偏
    expect(appendedKeys()).toEqual([]);
  });

  it('桥没报插队语义（老原生模块）→ 返回可观测失败，绝不假装成功', async () => {
    setQueue(['A', 'B', 'C'], 0);
    fake.state.tracks = ['A', 'B', 'C'].map((id) => ({ key: prefetchKey(song(id)), songId: id }));
    fake.state.index = 0;
    fake.state.key = prefetchKey(song('A'));
    // 真机 APK 实测：dex 里没有 insertAfterCurrent；老桥回包只有 accepted/revision/stale。
    // 旧实现把 "changed !== false" 当 changed=true → 日志 `changed=true` + 提示「已设为下一首」，
    // 而原生队列一字未改（对账仍是 4 首）→ 推进下一首播的是原来的窗口歌。
    fake.forced.push({ accepted: true, revision: 5, stale: false });

    const result = await nativePlayNext(song('C'));
    expect(result.queued).toBe(false);
    expect(result.reason).toBe('unsupported');
  });

  it('桥没报插队语义时 UI 侧同样回失败：队列/原生都不许出现「假成功」', async () => {
    setQueue(['A', 'B', 'C'], 0);
    fake.state.tracks = ['A', 'B', 'C'].map((id) => ({ key: prefetchKey(song(id)), songId: id }));
    fake.state.index = 0;
    fake.state.key = prefetchKey(song('A'));
    fake.forced.push({ accepted: true, revision: 5, stale: false });

    const outcome = await playNextInQueue(song('C'));
    expect(outcome.queued).toBe(false);
    expect(outcome.reason).toBe('unsupported');
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['A', 'B', 'C']);
    expect(fake.state.tracks.map((t) => t.songId)).toEqual(['A', 'B', 'C']);
  });
});

/**
 * #591 补窗结算契约：`feedWindow` 的每一轮必须**如实上报 outcome**，原生只读 outcome 结算。
 *
 * 两条原本各修一端的场景（#563 / #574）现在只是同一个契约的两个取值；这里钉住 JS 这一半
 * 的可观测契约（**修前会红**：旧实现根本不发 outcome，原生只能自己数 addedCount 推断）。
 *
 * ⚠️ 「原生据此绕回 / 只闩水位」那半段落在 Kotlin 的私有分支里，fake-only 的 Vitest 跑不了；
 * 文件末尾的源码契约守卫只证明形状存在，真正的行为验收必须真机（见 PR 正文的 logcat 原文）。
 */
describe('#591 补窗结算契约（JS 侧如实上报 outcome）', () => {
  /** 原生窗口 [A, B, C]，当前停在队尾 C；列表循环下 JS 的「下一首」应绕回 A/B。 */
  function tailFixture(): void {
    const queue = setQueue(['A', 'B', 'C'], 2);
    fake.state.tracks = queue.map((s) => ({ key: prefetchKey(s), songId: s.id }));
    fake.state.index = 2;
    fake.state.key = prefetchKey(song('C'));
  }

  // —— 两条「修前会红」的用例 ——

  it('#563 场景：原生窗口末项 + 补窗零新增（候选全已在原生手里）→ 上报 deduped', async () => {
    tailFixture();

    await feedWindow(undefined, 'hole');

    expect(fake.patchCalls).toHaveLength(1);
    const call = fake.patchCalls[0];
    // 旧实现这一轮只发 append（outcome 缺失）→ 原生只能数 addedCount 猜终局
    expect(call.outcome).toBe('deduped');
    // 'deduped' 必须**真的投了**候选（契约的入参前置条件）
    expect((call.append ?? []).map((t) => t.meta.key)).toEqual([
      prefetchKey(song('A')),
      prefetchKey(song('B')),
    ]);
    // QueueStore 全去重 → 原生队列一字未增、revision 不动（绕回的候选本来就在窗口里）
    expect(fake.state.tracks).toHaveLength(3);
    expect(fake.state.revision).toBe(5);
  });

  it('#574 场景：稳态水位（LOW_WATER）末项绕回 → 同样上报 deduped', async () => {
    tailFixture();

    // 无 reason = LOW_WATER（progressTick 每 1s 一次的那个来源）
    await feedWindow();

    expect(fake.patchCalls).toHaveLength(1);
    // #574 只改了 Kotlin：旧实现下这一轮没有任何 outcome，原生只能靠「append 非空且零新增」特例
    expect(fake.patchCalls[0].outcome).toBe('deduped');
    expect(fake.state.revision).toBe(5);
  });

  // —— 契约的其余边界 ——

  it('零候选 → outcome=empty；不再有「第二次、不带 append 的回执轮」', async () => {
    tailFixture();
    // 所有候选都解析不出直链（模拟「一个候选都没投出」）→ append 为空
    resolution.resolvePlayableUrlMobile.mockResolvedValueOnce({ url: '', nonFull: false } as never);
    resolution.resolvePlayableUrlMobile.mockResolvedValueOnce({ url: '', nonFull: false } as never);

    await feedWindow(undefined, 'hole');

    expect(fake.patchCalls).toHaveLength(1);
    expect(fake.patchCalls[0].outcome).toBe('empty');
    expect(fake.patchCalls[0].append).toBeUndefined();
    // 空轮不推进原生 revision（ADR 后果 #5）：否则别的在飞轮会被无谓判成 stale
    expect(fake.state.revision).toBe(5);
  });

  it('LOW_WATER 零候选同样如实上报 outcome=empty（reason 已退化为诊断标签）', async () => {
    tailFixture();
    resolution.resolvePlayableUrlMobile.mockResolvedValueOnce({ url: '', nonFull: false } as never);
    resolution.resolvePlayableUrlMobile.mockResolvedValueOnce({ url: '', nonFull: false } as never);

    await feedWindow();

    expect(fake.patchCalls).toHaveLength(1);
    expect(fake.patchCalls[0].outcome).toBe('empty');
  });

  it('候选正被别的补窗轮解析（在飞）→ 本轮不上报（契约里的并发闸门）', async () => {
    tailFixture();
    let release!: () => void;
    resolution.resolvePlayableUrlMobile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ url: 'https://cdn.example.com/A.mp3', nonFull: false });
        })
    );
    resolution.resolvePlayableUrlMobile.mockResolvedValueOnce({ url: '', nonFull: false } as never);

    const first = feedWindow(undefined, 'hole'); // 占住 A（in-flight）
    await flush();
    await feedWindow(undefined, 'hole'); // A 在飞 / B 冷却中 → 本轮零候选，但不得抢报 empty
    expect(fake.patchCalls).toHaveLength(0);

    release();
    await first;
    // 第一轮投了 A（已在原生手里）→ 它自己给出 deduped；整轮不会出现 empty
    expect(fake.patchCalls.some((call) => call.outcome === 'empty')).toBe(false);
    expect(fake.patchCalls.at(-1)?.outcome).toBe('deduped');
  });
});

/**
 * #591 原生结算的**源码契约守卫**。
 *
 * Vitest 是 Node 环境 + 假原生桥，无法执行 Kotlin（更无法断言私有标志）。这里的守卫只能证明
 * 「实现确实存在、形状是这段」，**不能替代 Kotlin 编译/设备验证**——#591 的行为验收在真机上
 * （PR 正文的两个场景 + 阳性对照的 logcat 原文）。
 */
describe('#591 原生结算：源码契约守卫（不替代 Kotlin 编译/设备验证）', () => {
  const MODULE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const read = (rel: string) => readFileSync(join(MODULE_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  const playerService = read(
    'modules/native-player/android/src/main/java/expo/modules/mplayerplayer/PlayerService.kt'
  );

  function body(start: string, end: string): string {
    const from = playerService.indexOf(start);
    expect(from, `找不到 ${start}`).toBeGreaterThanOrEqual(0);
    const to = playerService.indexOf(end, from + start.length);
    expect(to, `找不到 ${end}`).toBeGreaterThan(from);
    return playerService.slice(from, to);
  }

  it('patchQueue 只读 outcome 结算：deduped 绕回/结束，empty 也拉闩', () => {
    const patch = body('  fun patchQueue(', '  /**\n   * #591：结算入参的');
    expect(patch).toContain('settleOutcomeOf(outcome, append, upsert)');
    expect(patch).toContain('settled == SettleOutcome.DEDUPED');
    expect(patch).toContain('settled == SettleOutcome.EMPTY');
    expect(patch).toContain('val addedCount = newItems.size');
    expect(patch).toContain('firstExistingAppendIndex(append)');
    expect(patch).toContain('finishAtTail(ctrl)');
    // addedCount 退为诊断：不再单独充当终局判据
    expect(patch).not.toContain('if (addedCount == 0)');
    expect(patch).not.toContain('input.refillEmpty');

    const finish = body('  private fun finishAtTail(', '  private fun isExhaustedAtCurrent(');
    expect(finish).toContain('markExhausted()');
    expect(finish).toContain('EndReason.EXHAUSTED');
  });

  it('结算入参的前置条件：deduped 必须有候选、empty 必须没有', () => {
    const validate = body('  private fun settleOutcomeOf(', '  /**\n   * 本轮 append 里');
    expect(validate).toContain('SettleOutcome.DEDUPED -> hasCandidates');
    expect(validate).toContain('SettleOutcome.EMPTY -> !hasCandidates');
    expect(validate).toContain('return null');
  });

  it('LOW_WATER 在当前 (revision,index) 已闩住时直接返回（终结 ~2s 重问）', () => {
    const maybe = body('  private fun maybeRequestTracks(', '  /** 发 needTracks');
    expect(maybe).toContain('isExhaustedAtCurrent()');
    expect(maybe).toContain('NeedReason.LOW_WATER');
    // 闩检查必须在真正发 needTracks 之前
    expect(maybe.indexOf('isExhaustedAtCurrent()')).toBeLessThan(maybe.indexOf('requestTracks(reason)'));
  });

  it('显式用户意图 / 曲目切换 / 新队列都会清除终局闩', () => {
    expect(body('  fun play(', '  fun pause(')).toContain('clearExhausted()');
    expect(body('  fun next(', '  fun prev(')).toContain('clearExhausted()');
    expect(body('  fun prev(', '  fun seek(')).toContain('clearExhausted()');
    expect(
      body('  override fun onMediaItemTransition(', '  override fun onPlaybackStateChanged(')
    ).toContain('clearExhausted()');
    expect(body('  fun loadQueue(', '  fun patchQueue(')).toContain('clearExhausted()');
  });

  it('JS 每轮如实上报 outcome，refillEmpty 与第二次回执轮一起退场', () => {
    const js = read('services/nativePlayer.ts');
    expect(js).toMatch(/outcome: 'empty'/);
    expect(js).toMatch(/const outcome: PatchOutcome = append\.every/);
    expect(js).not.toMatch(/refillEmpty|acknowledgeEmptyRefill/);
  });

  it('#574：稳态水位末项（outcome=deduped/empty）也拉闩，且只闩水位、不冒充队列结束', () => {
    const patch = body('  fun patchQueue(', '  /**\n   * #591：结算入参的');
    const from = patch.indexOf('} else if ((settled == SettleOutcome.DEDUPED');
    expect(from, '找不到 #574 的稳态水位分支').toBeGreaterThan(-1);
    const branch = patch.slice(from);
    expect(branch).toContain('settled == SettleOutcome.EMPTY');
    expect(branch).toContain('markExhausted()');
    // 只闩 LOW_WATER：不暂停、不发 QUEUE_ENDED——播放没结束，曲末仍由原生 repeatMode 绕回
    expect(branch).not.toContain('finishAtTail(ctrl)');
    expect(branch).not.toContain('EndReason.EXHAUSTED');
  });
});

/**
 * #519：随机模式的**原生喂窗口**必须按稳定随机序，而不是每轮现抽一批。
 *
 * 现场（#519）：`补窗 mode=随机播放 计划=[120,72,68]→[93,170,87]→…` 每秒换一整批全新下标、
 * 9 分钟 0 条 `开始播放`。这里钉住「同一稳态下第一轮喂的就是序列下一批、第二轮不再换一批」。
 */
describe('#519：随机模式的补窗按稳定随机序（不再自激重抽）', () => {
  function lastAppendKeys(): string[] {
    return (fake.patchCalls.at(-1)?.append ?? []).map((t) => t.meta.key);
  }

  it('第一轮按随机序喂下一批；第二轮收敛（不再换一批全新的）', async () => {
    const queue = setQueue(['A', 'B', 'C', 'D', 'E', 'F'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['A', 'C', 'E', 'B', 'D', 'F'], cursor: 0 } });
    // 原生此刻只有当前曲 A
    fake.state.tracks = [{ key: prefetchKey(queue[0]), songId: 'A' }];
    fake.state.index = 0;
    fake.state.key = prefetchKey(song('A'));
    // 旧实现忽略序列、每轮现抽：用「每次调用都不同」的随机源让它稳定地换批（不靠运气）
    let n = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      n += 1;
      return (n % 6) / 6;
    });

    await feedWindow(2);
    expect(lastAppendKeys()).toEqual([prefetchKey(song('C')), prefetchKey(song('E'))]);

    fake.patchCalls.length = 0;
    await feedWindow(2);
    // 继续沿**同一份序列**往后补（不是换一批全新的随机下标）
    expect(lastAppendKeys()).toEqual([prefetchKey(song('B')), prefetchKey(song('D'))]);
    // 原生列表 = 随机序的前缀：这就是「计划收敛」的判据（旧实现每轮换一批，永远拼不出前缀）
    expect(fake.state.tracks.map((t) => t.songId)).toEqual(['A', 'C', 'E', 'B', 'D']);

    // 序列最后一首
    fake.patchCalls.length = 0;
    await feedWindow(2);
    expect(lastAppendKeys()).toEqual([prefetchKey(song('F'))]);
    expect(fake.state.tracks.map((t) => t.songId)).toEqual(['A', 'C', 'E', 'B', 'D', 'F']);

    // 序列全部喂完后：再补窗没有新候选（收敛，不再重抽、不再增长）
    fake.patchCalls.length = 0;
    await feedWindow(2);
    expect(lastAppendKeys()).toEqual([]);
  });

  it('原生推进到序列下一首后，窗口继续沿同一份序列补（不重抽）', async () => {
    const queue = setQueue(['A', 'B', 'C', 'D', 'E', 'F'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['A', 'C', 'E', 'B', 'D', 'F'], cursor: 0 } });
    fake.state.tracks = [
      { key: prefetchKey(queue[0]), songId: 'A' },
      { key: prefetchKey(song('C')), songId: 'C' },
    ];
    fake.state.index = 0;
    fake.state.key = prefetchKey(song('A'));
    await feedWindow(2);
    expect(lastAppendKeys()).toEqual([prefetchKey(song('E')), prefetchKey(song('B'))]);

    // 原生推进到 C（index=1，key 跟着变）→ 下一批从 C 之后继续：E/B 已在手里 → 补 D、F
    fake.state.index = 1;
    fake.state.key = prefetchKey(song('C'));
    fake.patchCalls.length = 0;
    await feedWindow(2);
    expect(lastAppendKeys()).toEqual([prefetchKey(song('D')), prefetchKey(song('F'))]);
    expect(fake.state.tracks.map((t) => t.songId)).toEqual(['A', 'C', 'E', 'B', 'D', 'F']);
  });
});

/**
 * #520 blocker 2（评审）：原位换源**必然换 id**，必须走 ADR 指定的 core
 * `replaceShuffleSongId`（同格换 id、顺序不动），否则：
 * - 换的是当前曲 → `setQueue` 后 `orderMatchesQueue` 为假 → **整条随机序重洗**；
 * - 换的不是当前曲 → 旧 id 滞留在序列里 → 下次对齐时该曲被**挪到序列末尾**。
 */
describe('#520 blocker 2：原位换源就地换 id（不重洗、不留旧 id）', () => {
  it('换当前曲：序列就地换 id，长度/位置/顺序都不变', async () => {
    setQueue(['A', 'B', 'C'], 1);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['A', 'B', 'C'], cursor: 1 } });

    nativeSongActionEffects.onApplied(song('B'), song('B2'), { exact: true } as never);
    await flush();

    const st = usePlayerStore.getState();
    expect(st.queue.map((s) => s.id)).toEqual(['A', 'B2', 'C']);
    expect(st.shuffle?.order).toEqual(['A', 'B2', 'C']);
    expect(st.shuffle?.cursor).toBe(1);
  });

  it('换非当前曲：序列里就地换 id，旧 id 不滞留', () => {
    setQueue(['A', 'B', 'C'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['C', 'B', 'A'], cursor: 2 } });

    nativeSongActionEffects.onApplied(song('C'), song('C2'), { exact: false } as never);

    const st = usePlayerStore.getState();
    expect(st.queue.map((s) => s.id)).toEqual(['A', 'B', 'C2']);
    expect(st.shuffle?.order).toEqual(['C2', 'B', 'A']);
    expect(st.shuffle?.order).not.toContain('C');
    expect(st.shuffle?.cursor).toBe(2);
  });
});
