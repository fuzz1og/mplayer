import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import type { TransportRequest, TransportResponse, TransportSignal } from '../../api/transport.js';
import {
  clearDirectClients,
  clearTier3Scheduling,
  getTier3InFlightCount,
  registerDirectClient,
  resolvePlayableSongRouted,
  resolvePlayableUrlRouted,
  setSourceModes,
  setTier3Resolver,
  type Tier3Resolution,
  type Tier3Resolver,
} from '../sourceRouter.js';
import {
  addTier3SubscriptionFromText,
  clearTier3ProbeCache,
  clearTier3Stats,
  createTier3Resolver,
  loadTier3State,
  setTier3Deps,
  setTier3Enabled,
} from '../../tier3/tier3Api.js';
import { beginInit } from '../sourceSchedule.js';
import { ResolutionBudgetExhaustedError } from '../resolutionBudget.js';

/**
 * **解析链总预算**（#424）的入口级验收。
 *
 * 背景：此前「一首歌最多让用户等多久」不存在于任何一处，只能把 5 个常量相加推出来
 * （直连 3s + tier3 6s + 第二条 tier3 腿 6s = 最坏 15s），且各腿只是「放弃等待」——
 * 底层请求继续跑完并继续重试。本文件钉住三件事：
 * 1. 一次解析链创建一个预算，作为**参数**贯穿各腿（并发两首歌各自计时，不是全局态）；
 * 2. 各腿局部墙语义不变（直连 3s、第一条 tier3 腿 6s），链预算只压缩「多出来的腿」；
 * 3. 预算耗尽 = 链在 T 毫秒内必然结算 + 在飞被 abort + tier3 在飞槽位归零。
 */

const song = (id: string, source = 'netease', overrides: Partial<Song> = {}): Song => ({
  id,
  name: `歌${id}`,
  artist: '歌手',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 240,
  sourceType: source as Song['sourceType'],
  ...overrides,
});

/** 永不落定的直连腿（只能被 3s 墙 / 解析链总预算收口）。 */
const hangingDirect = (source = 'qq') =>
  registerDirectClient({
    key: source as 'qq',
    searchSongs: vi.fn(async () => []),
    resolvePlayableUrl: vi.fn(() => new Promise<string>(() => {})),
  });

/** 四个 url-resolver 源（每个单源硬墙 2s）——足以把 tier3 腿撑到解析链总预算边界。 */
const fourSlowSources = JSON.stringify({
  version: 1,
  sources: ['s1', 's2', 's3', 's4'].map((id) => ({
    id,
    kind: 'url-resolver',
    source: 'netease',
    allowedDomains: ['cdn.example.com'],
    timeoutMs: 2000,
    resolve: { method: 'GET', url: `https://api.example.com/url?id={id}&s=${id}`, responseJsonPath: 'data.url' },
  })),
});

beforeEach(() => {
  clearDirectClients();
  setSourceModes({});
  setTier3Resolver(null);
  setTier3Enabled(false);
  setTier3Deps({});
  loadTier3State(undefined);
  clearTier3Stats();
  clearTier3ProbeCache();
  clearTier3Scheduling();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('解析链总预算（#424）', () => {
  it('预算是参数不是模块级全局态：并发两首歌各自计时，互不牵连', async () => {
    vi.useFakeTimers();
    hangingDirect();
    const short = resolvePlayableSongRouted(song('short', 'qq'), { budgetMs: 1_000 });
    const long = resolvePlayableSongRouted(song('long', 'qq'), { budgetMs: 5_000 });
    let shortSettled = false;
    let longSettled = false;
    void short.then(() => { shortSettled = true; }, () => { shortSettled = true; });
    void long.then(() => { longSettled = true; }, () => { longSettled = true; });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(shortSettled).toBe(true); // 1s 预算的那条已收口（墙被夹到 1s）
    expect(longSettled).toBe(false); // 5s 预算的那条不受另一条影响
    await vi.advanceTimersByTimeAsync(2_100);
    expect(longSettled).toBe(true);
  });

  it('预算耗尽 → 通过 control.signal abort 在飞的 tier3、槽位归零、链以预算错误 reject', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const tier3 = vi.fn((_s: Song, _c?: unknown, control?: { signal?: AbortSignal }) => {
      const signal = control?.signal;
      if (signal) signals.push(signal);
      return new Promise<Tier3Resolution | null>((resolve) => {
        if (!signal) return; // 无信号 = 永不落定
        if (signal.aborted) { resolve(null); return; }
        signal.addEventListener('abort', () => resolve(null));
      });
    });
    setTier3Enabled(true);
    setTier3Resolver(tier3 as unknown as Tier3Resolver);
    hangingDirect();

    const pending = resolvePlayableSongRouted(song('a-chain', 'qq'));
    const assertion = expect(pending).rejects.toBeInstanceOf(ResolutionBudgetExhaustedError);
    await vi.advanceTimersByTimeAsync(3_000); // 直连 3s 墙到点 → 进 tier3
    expect(tier3).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    expect(getTier3InFlightCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(6_000); // 解析链总预算 9s 到点
    await assertion;
    expect(signals[0].aborted).toBe(true); // 「放弃等待」变成「真的停掉」
    await vi.advanceTimersByTimeAsync(10);
    expect(getTier3InFlightCount()).toBe(0);
  });

  it('各腿局部墙语义不变：直连腿仍 3s、第一条 tier3 腿仍拿满 6s', async () => {
    vi.useFakeTimers();
    registerDirectClient({
      key: 'qq',
      searchSongs: vi.fn(async () => []),
      resolvePlayableUrl: vi.fn(async () => ''), // 直连秒回空串 → tier3 立刻起腿
    });
    setTier3Enabled(true);
    const tier3 = vi.fn(() => new Promise<Tier3Resolution | null>(() => {}));
    setTier3Resolver(tier3 as unknown as Tier3Resolver);

    const pending = resolvePlayableSongRouted(song('legs', 'qq'));
    let settled = false;
    let url = '';
    void pending.then((r) => { settled = true; url = r.url; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(5_900);
    expect(settled).toBe(false); // 腿预算 6s 未到，解析链总预算（9s）还管不到它
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);
    expect(url).toBe(''); // 腿预算先到 → 按未命中返回直连空串（不是总预算 reject）
    expect(tier3).toHaveBeenCalledTimes(1);
  });

  it('第二条 tier3 腿（试听换完整版）只吃剩余额度：链在 9s 收口，不再叠加成 15s', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const tier3 = vi.fn(() => {
      calls += 1;
      // 第一条腿 4s 后未命中（键被清）→ 第二条腿重新发起，且永不落定。
      if (calls === 1) return new Promise<Tier3Resolution | null>((resolve) => setTimeout(() => resolve(null), 4_000));
      return new Promise<Tier3Resolution | null>(() => {});
    });
    setTier3Enabled(true);
    setTier3Resolver(tier3 as unknown as Tier3Resolver);
    registerDirectClient({
      key: 'netease',
      searchSongs: vi.fn(async () => []),
      resolveUrlInfo: vi.fn(async () => ({
        url: 'https://cdn.example.com/trial.mp3',
        br: 128,
        size: 1_000,
        playTime: 30_000, // 30s vs 标称 240s → 试听版
        fee: 0,
        payed: 0,
      })),
    });

    const pending = resolvePlayableSongRouted(song('two-legs', 'netease', { audioTag: 'invalid', duration: 240 }));
    const assertion = expect(pending).rejects.toBeInstanceOf(ResolutionBudgetExhaustedError);
    await vi.advanceTimersByTimeAsync(3_900);
    expect(tier3).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(tier3).toHaveBeenCalledTimes(2); // 第二条腿只能吃 (9000 - 4050) 的剩余额度
    await vi.advanceTimersByTimeAsync(4_800);
    await vi.advanceTimersByTimeAsync(200); // t≈9.05s：若第二条腿有自己的 6s，这里还不会结算
    await assertion;
  });

  it('resolvePlayableUrlRouted（IPC 另一入口）同样受解析链总预算约束', async () => {
    vi.useFakeTimers();
    hangingDirect();
    setTier3Enabled(true);
    setTier3Resolver(vi.fn(() => new Promise<Tier3Resolution | null>(() => {})) as unknown as Tier3Resolver);
    const pending = resolvePlayableUrlRouted(song('url-chain', 'qq'));
    const assertion = expect(pending).rejects.toBeInstanceOf(ResolutionBudgetExhaustedError);
    await vi.advanceTimersByTimeAsync(9_000);
    await assertion;
  });

  it('永不落定的假 transport（真 tier3 执行器）：链 9s 内结算、在飞被 abort、in-flight 归零', async () => {
    vi.useFakeTimers();
    const signals: TransportSignal[] = [];
    const request = vi.fn((req: TransportRequest) => {
      if (req.signal) signals.push(req.signal);
      return new Promise<TransportResponse>((_resolve, reject) => {
        req.signal?.addEventListener?.('abort', () =>
          reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', isAxiosError: true })),
        );
      });
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: fourSlowSources });
    setTier3Enabled(true);
    setTier3Resolver(createTier3Resolver());
    beginInit(); // 关掉单飞初始化窗口，走常态串行
    hangingDirect('netease');

    const pending = resolvePlayableSongRouted(song('chain-real', 'netease'));
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(8_900);
    expect(signals.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(signals.some((s) => s.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(getTier3InFlightCount()).toBe(0);
  });
});
