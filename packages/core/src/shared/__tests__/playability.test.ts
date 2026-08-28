import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import { classifyLength, isTrialUrlInfo, type UrlInfo } from '../../api/audioProbe.js';
import {
  registerDirectClient,
  clearDirectClients,
  setSourceMode,
  setSourceModes,
  resolvePlayableSongRouted,
  setTier3Enabled,
  setTier3Resolver,
} from '../sourceRouter.js';
import { clearPrefetchCache, setPrefetchedUrl } from '../../api/prefetchCache.js';

/**
 * T12 试听版检测 + 可播性预检测试（#158）。
 * - classifyLength / isTrialUrlInfo：纯函数，独立边界向量（0.95 完整 / 0.5 试听分界）。
 * - resolvePlayableSongRouted：接缝矩阵（UrlInfo trial → nonFull；无 UrlInfo →
 *   resolvePlayableUrl；空 URL → 换元层；直连失败且 tier3 未命中 → 上抛）。
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
    expect(res).toEqual({ url: 'https://prefetch.example.com/1.mp3', nonFull: true });
  });

  it('预取缓存未命中：正常走直连解析', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res).toEqual({ url: 'https://direct.mp3', nonFull: false });
  });

  it('直连 UrlInfo playTime 明显短于标称 → nonFull=true', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
      resolveUrlInfo: vi.fn(async () => ({ url: 'https://direct.mp3', br: 128, size: 1, playTime: 30_000, fee: 0, payed: 1 })),
    });
    const res = await resolvePlayableSongRouted(song(240));
    expect(res).toEqual({ url: 'https://direct.mp3', nonFull: true });
  });

  it('直连 UrlInfo 完整时长 → nonFull=false', async () => {
    registerDirectClient({
      key: 'netease',
      resolveUrlInfo: vi.fn(async () => ({ url: 'https://direct.mp3', br: 128, size: 1, playTime: 240_000, fee: 0, payed: 1 })),
    });
    const res = await resolvePlayableSongRouted(song(240));
    expect(res).toEqual({ url: 'https://direct.mp3', nonFull: false });
  });

  it('客户端无 UrlInfo → 走 resolvePlayableUrl，nonFull=false', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res).toEqual({ url: 'https://direct.mp3', nonFull: false });
  });

  it('直连返回空 URL（无版权/VIP）→ 原样上抛换元层', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => ''),
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res).toEqual({ url: '', nonFull: false });
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
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'invalid' }));
    expect(tier3).toHaveBeenCalled();
    expect(res).toEqual({ url: 'https://tier3.example.com/1.mp3', nonFull: false });
  });

  it('未配置 tier3 + audioTag=invalid：保留直连 URL，由上层继续弹窗/换元', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'invalid' }));
    expect(res).toEqual({ url: 'https://direct.mp3', nonFull: false });
  });

  it('audioTag=preview：走 tier3 尝试拿完整版，命中则 nonFull=false（试听无意义，兜底优先）', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'preview' }));
    expect(tier3).toHaveBeenCalled();
    expect(res).toEqual({ url: 'https://tier3.example.com/1.mp3', nonFull: false });
  });

  it('audioTag=preview：tier3 未命中 → 退回直连试听并标 nonFull', async () => {
    const tier3 = vi.fn(async () => '');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'preview' }));
    expect(res).toEqual({ url: 'https://direct.mp3', nonFull: true });
  });

  it('audioTag=preview：tier3 未配置 → 直接播直连试听（零成本回退）', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240, { audioTag: 'preview' }));
    expect(res).toEqual({ url: 'https://direct.mp3', nonFull: true });
  });

  it('tier3 resolver 超过 6s 预算 → 按未命中处理，不阻塞播放（慢源如 mgmp3 20s 超时）', async () => {
    vi.useFakeTimers();
    const tier3 = vi.fn(() => new Promise<string>(() => { /* 永不 resolve，模拟挂起的慢源 */ }));
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
    expect(res).toEqual({ url: '', nonFull: false });
    vi.useRealTimers();
  });

  it('预算内 tier3 命中仍生效（正常源不受预算影响）', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => ''),
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res).toEqual({ url: 'https://tier3.example.com/1.mp3', nonFull: false });
  });
});
