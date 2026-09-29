import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LYRICS_HYDRATION_BURST_CAP,
  LYRICS_HYDRATION_SETTLED_LIMIT,
  awaitLyricsHydrationIdle,
  cancelAllLyricsHydration,
  cancelLyricsHydration,
  enqueueLyricsHydration,
  getLyricsHydrationStats,
  resetLyricsHydrator,
  setLyricsHydratorDeps,
} from '../lyricsHydrator.js';
import {
  setTransport,
  setTransportRetryOptions,
  type TransportRequest,
} from '../../api/transport.js';
import {
  getOutboundGateStats,
  resetOutboundGate,
  setOutboundGateOptions,
} from '../../api/outboundGate.js';
import { cacheManager } from '../../api/memoryCacheManager.js';
import type { Song } from '../../types/index.js';

/**
 * 歌词入队取词（#429）：本模块只负责**入队纪律**——single-flight / 取消 / 预算 /
 * 不进重试风暴；**并发与限速一律由 transport 的双层闸门（#408）承担**，
 * 这些用例同时是「hydrator 没有自建第三套并发策略」的守卫。
 */

const song = (id: string, sourceType: Song['sourceType'] = 'netease'): Song => ({
  id,
  name: `歌${id}`,
  artist: '歌手',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 1,
  sourceType,
});

/** 让出一轮宏任务：闸门里 `Promise.resolve` 放行的在飞请求在此刻真正进入底层传输。 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 手控假取词器：调用即挂起，测试自己决定何时结算。 */
function deferredFetcher() {
  const calls: string[] = [];
  const pending: { songId: string; resolve: (lrc: string) => void }[] = [];
  return {
    calls,
    pending,
    fetcher: (songId: string): Promise<string> =>
      new Promise<string>((resolve) => {
        calls.push(songId);
        pending.push({ songId, resolve });
      }),
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

beforeEach(() => {
  cacheManager.clearAll();
  resetOutboundGate();
  resetLyricsHydrator();
});

afterEach(() => {
  resetLyricsHydrator();
  resetOutboundGate();
  setLyricsHydratorDeps(null);
  setTransport(null);
  setTransportRetryOptions(null);
  cacheManager.clearAll();
});

describe('lyricsHydrator 入队纪律（#429）', () => {
  it('同 songId single-flight：在飞与已结算都不再重复取词', async () => {
    const fake = deferredFetcher();
    setLyricsHydratorDeps({ fetchLyrics: fake.fetcher });

    const target = song('1');
    enqueueLyricsHydration(target);
    enqueueLyricsHydration(target);
    enqueueLyricsHydration([target]);
    expect(fake.calls).toEqual(['1']);

    fake.pending[0].resolve('');
    await awaitLyricsHydrationIdle();

    // 空词同样算「已结算」（网易那边空词也进缓存），再入队不该再打一次
    enqueueLyricsHydration(target);
    expect(fake.calls).toEqual(['1']);
    expect(getLyricsHydrationStats()).toMatchObject({ dispatched: 1, deduped: 3, inFlight: 0 });
  });

  it('只接纳网易（当前唯一有按 ID 取词实现的源），其余源原样跳过', async () => {
    const fake = deferredFetcher();
    setLyricsHydratorDeps({ fetchLyrics: fake.fetcher });

    enqueueLyricsHydration([
      song('1', 'soda'),
      song('2', 'qq'),
      song('3', 'kugou'),
      song('4', 'netease'),
    ]);
    expect(fake.calls).toEqual(['4']);
    expect(getLyricsHydrationStats()).toMatchObject({ dispatched: 1, unsupported: 3 });

    cancelAllLyricsHydration();
  });

  it('单次入队 100 首：只派发前 LYRICS_HYDRATION_BURST_CAP 个，其余计入 dropped', () => {
    const fake = deferredFetcher();
    setLyricsHydratorDeps({ fetchLyrics: fake.fetcher });

    enqueueLyricsHydration(Array.from({ length: 100 }, (_, i) => song(String(i))));

    expect(fake.calls).toHaveLength(LYRICS_HYDRATION_BURST_CAP);
    expect(getLyricsHydrationStats()).toMatchObject({
      dispatched: LYRICS_HYDRATION_BURST_CAP,
      dropped: 100 - LYRICS_HYDRATION_BURST_CAP,
    });

    cancelAllLyricsHydration();
  });

  it('取词失败也结算：滚动回来不重试（预取不进重试风暴，兜底在播放期取词）', async () => {
    let calls = 0;
    setLyricsHydratorDeps({
      fetchLyrics: async () => {
        calls += 1;
        throw new Error('boom');
      },
    });

    const target = song('9');
    enqueueLyricsHydration(target);
    await awaitLyricsHydrationIdle();
    enqueueLyricsHydration(target);

    expect(calls).toBe(1);
    expect(getLyricsHydrationStats()).toMatchObject({ failed: 1, dispatched: 1, deduped: 1 });
  });

  it('已结算记忆有上限：超限后旧 key 可再次入队（真缓存仍在，命中零请求）', async () => {
    let calls = 0;
    setLyricsHydratorDeps({
      fetchLyrics: async () => {
        calls += 1;
        return '';
      },
    });

    for (let i = 0; i <= LYRICS_HYDRATION_SETTLED_LIMIT; i += 1) {
      enqueueLyricsHydration(song(`k${i}`));
      await awaitLyricsHydrationIdle();
    }
    expect(getLyricsHydrationStats().settled).toBeLessThanOrEqual(LYRICS_HYDRATION_SETTLED_LIMIT);

    const before = calls;
    enqueueLyricsHydration(song('k0'));
    await awaitLyricsHydrationIdle();
    expect(calls).toBe(before + 1);
  });

  it('取消只影响在飞项：取消过的 key 可以重新入队（不算已结算）', async () => {
    const fake = deferredFetcher();
    setLyricsHydratorDeps({ fetchLyrics: fake.fetcher });

    const target = song('7');
    enqueueLyricsHydration(target);
    cancelLyricsHydration(target);
    enqueueLyricsHydration(target);

    expect(fake.calls).toEqual(['7', '7']);
    expect(getLyricsHydrationStats().cancelled).toBe(1);

    cancelAllLyricsHydration();
  });
});

describe('lyricsHydrator 经 transport 出网（#429 边界：并发/限速全交给 #408 闸门）', () => {
  beforeEach(() => {
    setTransportRetryOptions({ maxRetries: 0, baseDelayMs: 0 });
    setOutboundGateOptions({ maxGlobal: 6, maxPerHost: 2 });
  });

  it('分批入队 100 首（10 批 × 10）：上游恰好 100 次请求（= 实际采纳数），同 host 并发峰值 ≤ 2（无第三套并发策略）', async () => {
    const seen: TransportRequest[] = [];
    setTransport(async (req) => {
      seen.push(req);
      await tick();
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ lrc: { lyric: `[00:01.00]词${req.url}` } }),
        finalUrl: req.url,
      };
    });

    // 预算是**单次入队**上限、不是吞吐上限：分批进来就不受它限制，
    // 上游请求数 = 实际采纳数。
    const songs = Array.from({ length: 100 }, (_, i) => song(String(i)));
    for (const batch of chunk(songs, 10)) enqueueLyricsHydration(batch);
    await awaitLyricsHydrationIdle();

    expect(seen).toHaveLength(100);
    expect(seen.every((r) => r.url.includes('/api/song/lyric'))).toBe(true);
    const gate = getOutboundGateStats();
    expect(gate.peakPerHost).toBeLessThanOrEqual(2);
    expect(gate.peakInFlight).toBeLessThanOrEqual(6);
    expect(getLyricsHydrationStats()).toMatchObject({ dispatched: 100, dropped: 0, inFlight: 0 });
  });

  it('单次入队 100 首：底层传输恰好被采纳的 30 条触达，其余 70 条 dropped（预算口径可断言）', async () => {
    const seen: TransportRequest[] = [];
    setTransport(async (req) => {
      seen.push(req);
      await tick();
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ lrc: { lyric: '[00:01.00]词' } }),
        finalUrl: req.url,
      };
    });

    enqueueLyricsHydration(Array.from({ length: 100 }, (_, i) => song(String(i))));
    await awaitLyricsHydrationIdle();

    expect(seen).toHaveLength(LYRICS_HYDRATION_BURST_CAP);
    expect(getLyricsHydrationStats()).toMatchObject({
      dispatched: LYRICS_HYDRATION_BURST_CAP,
      dropped: 100 - LYRICS_HYDRATION_BURST_CAP,
      inFlight: 0,
    });
    expect(getOutboundGateStats().queued).toBe(0);
  });

  it('取消后不再出网：排队项从闸门摘除，底层传输一次都不进', async () => {
    const seen: string[] = [];
    const release: (() => void)[] = [];
    setTransport(
      (req) =>
        new Promise((resolve) => {
          seen.push(req.url);
          release.push(() =>
            resolve({ status: 200, headers: {}, body: '{}', finalUrl: req.url }),
          );
        }),
    );

    const songs = Array.from({ length: 100 }, (_, i) => song(String(i)));
    for (const batch of chunk(songs, 10)) enqueueLyricsHydration(batch);
    await tick();
    // 每 host 上限 2：只有这两条真的进入底层传输，其余 98 条在闸门队列里
    expect(seen).toHaveLength(2);
    expect(getOutboundGateStats().queued).toBe(98);

    cancelAllLyricsHydration();
    expect(getOutboundGateStats().queued).toBe(0);
    expect(getLyricsHydrationStats().cancelled).toBe(100);

    release.forEach((fn) => fn());
    await awaitLyricsHydrationIdle();
    // 被取消的 98 条从未触达底层传输；已出网的 2 条不回滚（不可撤回）
    expect(seen).toHaveLength(2);
    expect(getLyricsHydrationStats()).toMatchObject({ cancelled: 100, failed: 0, inFlight: 0 });
  });
});
