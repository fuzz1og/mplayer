import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import { classifyLength, isTrialUrlInfo, type UrlInfo } from '../../api/audioProbe.js';
import {
  registerDirectClient,
  clearDirectClients,
  setSourceMode,
  setSourceModes,
  configureSourceRouter,
  resolvePlayableSongRouted,
} from '../sourceRouter.js';

/**
 * T12 试听版检测 + 可播性预检测试（#158）。
 * - classifyLength / isTrialUrlInfo：纯函数，独立边界向量（0.95 完整 / 0.5 试听分界）。
 * - resolvePlayableSongRouted：接缝矩阵（UrlInfo trial → nonFull；无 UrlInfo →
 *   resolvePlayableUrl；空 URL → 换元层；auto 回退）。
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
  setSourceModes({});
  configureSourceRouter({
    searchSongs: vi.fn(async () => []),
    getAudioUrl: vi.fn(async (u: string) => `api:${u}`),
  });
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

  it('auto 直连失败 → 回退 api 腿', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }),
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('api:https://api.example.com/x.mp3');
    expect(res.nonFull).toBe(false);
  });

  it('direct 模式失败 → 上抛', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }),
    });
    setSourceMode('netease', 'direct');
    await expect(resolvePlayableSongRouted(song())).rejects.toThrow('直连失败');
  });

  it('api 模式 → 直接走 api 腿', async () => {
    registerDirectClient({ key: 'netease', resolvePlayableUrl: vi.fn(async () => 'https://direct.mp3') });
    setSourceMode('netease', 'api');
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('api:https://api.example.com/x.mp3');
  });
});
