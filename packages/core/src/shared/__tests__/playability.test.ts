import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import { classifyLength, isTrialUrlInfo, type UrlInfo } from '../../api/audioProbe.js';
import { isNonFullDirect } from '../playability.js';
import {
  registerDirectClient,
  clearDirectClients,
  setSourceMode,
  setSourceModes,
  resolvePlayableSongRouted,
  setTier3Enabled,
  setTier3Resolver,
  setDirectValidator,
  type PlaybackGuard,
  type Tier3Resolution,
} from '../sourceRouter.js';
import { clearPrefetchCache, setPrefetchedUrl } from '../../api/prefetchCache.js';

// #392 直连腿取证默认会真发 Range：本文件测路由语义，关闭取证以保持零 I/O。
beforeEach(() => { setDirectValidator(null); });

/**
 * T12 试听版检测 + 可播性预检测试（#158）。
 * - classifyLength / isTrialUrlInfo：纯函数，独立边界向量（0.95 完整 / 0.5 试听分界）。
 * - resolvePlayableSongRouted：接缝矩阵（UrlInfo trial → nonFull；无 UrlInfo →
 *   resolvePlayableUrl；空 URL → 换元层；直连失败且 tier3 未命中 → 上抛）。
 * #361 起解析结果带 `via` / `guard`：直连腿恒为 `direct` / `none`，
 * tier3 腿为 `tier3` + 护栏证据等级。
 */

const song = (duration = 240, overrides: Partial<Song> = {}): Song => ({
  id: '1',
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: 'https://api.example.com/x.mp3',
  cover: '',
  lrc: '',
  duration,
  sourceType: 'netease',
  ...overrides,
});

/** 直连腿结果（via=direct / guard=none，护栏只约束 tier3 替换的 URL）。 */
const directResult = (url: string, nonFull: boolean) =>
  ({ url, nonFull, via: 'direct' as const, guard: 'none' as const });

/** tier3 腿结果（护栏通过，nonFull 恒 false）。 */
const tier3Result = (url: string, guard: PlaybackGuard = 'none') =>
  ({ url, nonFull: false, via: 'tier3' as const, guard });

/** 注入 tier3 解析器：url 为空 = 未命中（null）。 */
const tier3Resolver = (url: string, guard: PlaybackGuard = 'none') =>
  vi.fn(async (): Promise<Tier3Resolution | null> => (url ? { url, guard } : null));

beforeEach(() => {
  clearDirectClients();
  clearPrefetchCache();
  setSourceModes({});
  setTier3Enabled(false);
  setTier3Resolver(null);
});

describe('classifyLength 完整时长校验', () => {
  it('≥0.95 → full', () => {
    expect(classifyLength(228_000, 240)).toBe('full'); // 95%
    expect(classifyLength(240_000, 240)).toBe('full');
  });

  it('<0.5 → trial（试听版）', () => {
    expect(classifyLength(30_000, 240)).toBe('trial'); // 30s / 240s
  });

  it('playTime 为 0（数据缺失）→ unknown', () => {
    expect(classifyLength(0, 240)).toBe('unknown');
  });

  it('0.5~0.95 → unknown（交下载探测）', () => {
    expect(classifyLength(120_000, 240)).toBe('unknown'); // 50%
  });

  it('标称时长缺失 → unknown', () => {
    expect(classifyLength(200_000, 0)).toBe('unknown');
    expect(classifyLength(0, 0)).toBe('unknown');
  });

  it('isTrialUrlInfo 依据时长比判定', () => {
    const info: UrlInfo = { url: 'https://x.mp3', br: 128, size: 1000, playTime: 30_000, fee: 1, payed: 0 };
    expect(isTrialUrlInfo(info, 240)).toBe(true);
    expect(isTrialUrlInfo({ ...info, playTime: 240_000 }, 240)).toBe(false);
  });
});

/**
 * #539：试听判定的**唯一实现**。
 * 此前 sourceRouter 的三个调用点各写一套布尔式（预取 nonFull / isTrialUrlInfo||audioTag /
 * 纯 audioTag），其中一条入口腿还漏了 audioTag，两条腿语义分叉。这里用矩阵钉死：
 * 三个信号任一命中即试听，且三者互不掩盖。
 */
describe('isNonFullDirect（#539 试听判定唯一来源）', () => {
  const info = (playTimeMs: number): UrlInfo => ({
    url: 'https://x.mp3',
    br: 128,
    size: 1000,
    playTime: playTimeMs,
    fee: 1,
    payed: 0,
  });

  it('三个信号全无 → 完整版', () => {
    expect(isNonFullDirect({ audioTag: undefined, duration: 240 })).toBe(false);
    expect(isNonFullDirect({ audioTag: 'full', info: info(240_000), duration: 240 })).toBe(false);
  });

  it('audioTag=preview → 试听（即使权威时长是完整的）', () => {
    expect(isNonFullDirect({ audioTag: 'preview', info: info(240_000), duration: 240 })).toBe(true);
  });

  it('UrlInfo 权威时长明显偏短 → 试听', () => {
    expect(isNonFullDirect({ audioTag: undefined, info: info(30_000), duration: 240 })).toBe(true);
  });

  it('取证判为片段 → 试听', () => {
    expect(isNonFullDirect({ audioTag: undefined, duration: 240, validatedNonFull: true })).toBe(true);
  });

  it('三个信号同时命中 → 仍是试听（不因重复而翻转）', () => {
    expect(
      isNonFullDirect({ audioTag: 'preview', info: info(30_000), duration: 240, validatedNonFull: true }),
    ).toBe(true);
  });

  it('缺标称时长时不臆断：只有 UrlInfo 判据失效，其余照常', () => {
    // duration 缺失 → isTrialUrlInfo 走 classifyLength 的 unknown，不判试听
    expect(isNonFullDirect({ info: info(30_000), duration: 0 })).toBe(false);
    // 但 audioTag 与取证不依赖标称时长
    expect(isNonFullDirect({ audioTag: 'preview', duration: 0 })).toBe(true);
    expect(isNonFullDirect({ duration: 0, validatedNonFull: true })).toBe(true);
  });
});

describe('resolvePlayableSongRouted（带试听检测的播放解析）', () => {
  it('预取缓存命中：直接返回缓存 URL + nonFull，不再调直连客户端', async () => {
    const client = {
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    };
    registerDirectClient(client);
    setPrefetchedUrl(song(240), 'https://prefetch.example.com/1.mp3', true);

    const res = await resolvePlayableSongRouted(song(240));

    expect(client.resolvePlayableUrl).not.toHaveBeenCalled();
    // 预取缓存只存直连结果 → 直连腿（无 tier3 命中）
    expect(res).toEqual(directResult('https://prefetch.example.com/1.mp3', true));
  });

  it('预取缓存未命中：正常走直连解析', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res).toEqual(directResult('https://direct.mp3', false));
  });

  it('直连 UrlInfo playTime 明显短于标称 → nonFull=true', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
      resolveUrlInfo: vi.fn(async () => ({ url: 'https://direct.mp3', br: 128, size: 1, playTime: 30_000, fee: 0, payed: 1 })),
    });
    const res = await resolvePlayableSongRouted(song(240));
    expect(res).toEqual(directResult('https://direct.mp3', true));
  });

  it('直连 UrlInfo 完整时长 → nonFull=false', async () => {
    registerDirectClient({
      key: 'netease',
      resolveUrlInfo: vi.fn(async () => ({ url: 'https://direct.mp3', br: 128, size: 1, playTime: 240_000, fee: 0, payed: 1 })),
    });
    const res = await resolvePlayableSongRouted(song(240));
    expect(res).toEqual(directResult('https://direct.mp3', false));
  });

  it('客户端无 UrlInfo → 走 resolvePlayableUrl，nonFull=false', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res).toEqual(directResult('https://direct.mp3', false));
  });

  it('直连返回空 URL（无版权/VIP）→ 原样上抛换元层', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => ''),
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res).toEqual(directResult('', false));
  });

  it('auto 直连失败且 tier3 未命中 → 上抛（D2，api 腿已拆除）', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }),
    });
    await expect(resolvePlayableSongRouted(song())).rejects.toThrow('直连失败');
  });

  it('direct 模式失败 → 上抛', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }),
    });
    setSourceMode('netease', 'direct');
    await expect(resolvePlayableSongRouted(song())).rejects.toThrow('直连失败');
  });

  it('开启 tier3 + audioTag=invalid：直连返回非空也优先用 tier3', async () => {
    const tier3 = tier3Resolver('https://tier3.example.com/1.mp3', 'text-only');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'invalid' }));
    expect(tier3).toHaveBeenCalled();
    expect(res).toEqual(tier3Result('https://tier3.example.com/1.mp3', 'text-only'));
  });

  it('未配置 tier3 + audioTag=invalid：保留直连 URL，由上层继续弹窗/换元', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'invalid' }));
    expect(res).toEqual(directResult('https://direct.mp3', false));
  });

  it('audioTag=preview：走 tier3 尝试拿完整版，命中则 nonFull=false（试听无意义，兜底优先）', async () => {
    const tier3 = tier3Resolver('https://tier3.example.com/1.mp3', 'source-duration');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'preview' }));
    expect(tier3).toHaveBeenCalled();
    expect(res).toEqual(tier3Result('https://tier3.example.com/1.mp3', 'source-duration'));
  });

  it('audioTag=preview：tier3 未命中 → 退回直连试听并标 nonFull', async () => {
    const tier3 = tier3Resolver('');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'preview' }));
    expect(res).toEqual(directResult('https://direct.mp3', true));
  });

  it('audioTag=preview：tier3 未配置 → 直接播直连试听（零成本回退）', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'preview' }));
    expect(res).toEqual(directResult('https://direct.mp3', true));
  });

  it('tier3 resolver 超过 6s 预算 → 按未命中处理，不阻塞播放（慢源如 mgmp3 20s 超时）', async () => {
    vi.useFakeTimers();
    const tier3 = vi.fn(() => new Promise<Tier3Resolution | null>(() => { /* 永不 resolve，模拟挂起的慢源 */ }));
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => ''), // 直连无版权 → tier3
    });
    const promise = resolvePlayableSongRouted(song());
    // advanceTimersByTimeAsync：推进 fake 时钟并 flush 微任务链
    // （resolvePlayableSongRouted 需先走到 tryTier3 注册 race 的 setTimeout）
    await vi.advanceTimersByTimeAsync(6_000);
    const res = await promise;
    expect(res).toEqual(directResult('', false));
    vi.useRealTimers();
  });

  it('预算内 tier3 命中仍生效（正常源不受预算影响）', async () => {
    const tier3 = tier3Resolver('https://tier3.example.com/1.mp3', 'size-bitrate');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => ''),
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res).toEqual(tier3Result('https://tier3.example.com/1.mp3', 'size-bitrate'));
  });
});
