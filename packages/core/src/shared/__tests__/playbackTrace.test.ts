import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setPlaybackTraceSink,
  getPlaybackTraceSink,
  isPlaybackTraceEnabled,
  createPlaybackTraceRing,
  type PlaybackTrace,
  type PlaybackProbeTrace,
} from '../playbackTrace.js';
import {
  registerDirectClient,
  clearDirectClients,
  setSourceModes,
  setTier3Enabled,
  setTier3Resolver,
  resolvePlayableSongRouted,
  setDirectValidator,
  type DirectSourceClient,
} from '../sourceRouter.js';
import { clearPrefetchCache, setPrefetchedUrl } from '../../api/prefetchCache.js';

// #392 直连腿取证默认会真发 Range：本文件测 trace，关闭直连取证以保持零 I/O。
beforeEach(() => { setDirectValidator(null); });
import type { Song } from '../../types/index.js';

// 探测的 URL 校验是系统边界：mock 掉 probeAudioUrl，让 trace 在无网络下可控。
vi.mock('../../api/audioProbe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/audioProbe.js')>();
  return { ...actual, probeAudioUrl: vi.fn() };
});
import { probeAudioUrl } from '../../api/audioProbe.js';
import { musicApi } from '../../api/musicApi.js';

/**
 * 播放解析链结构化 trace（#363）：core 出 trace、宿主落 sink。
 * 覆盖：层级/腿/护栏字段、每源 leg、sink 关闭零成本、环形缓冲、探测腿 resolve/validate 拆分。
 */

const song = (id: string, source = 'netease', url = ''): Song => ({
  id,
  name: `歌${id}`,
  artist: '歌手',
  album: '',
  url,
  cover: '',
  lrc: '',
  duration: 180,
  sourceType: source as Song['sourceType'],
});

function makeClient(source: string, overrides: Partial<DirectSourceClient> = {}): DirectSourceClient {
  return {
    key: source as DirectSourceClient['key'],
    resolvePlayableUrl: vi.fn(async () => 'https://direct.example.com/1.mp3'),
    ...overrides,
  };
}

beforeEach(() => {
  clearDirectClients();
  clearPrefetchCache();
  setSourceModes({});
  setTier3Enabled(false);
  setTier3Resolver(null);
  setPlaybackTraceSink(null);
  vi.mocked(probeAudioUrl).mockReset();
});

describe('playbackTrace sink 接缝', () => {
  it('默认未注册：isPlaybackTraceEnabled=false、getPlaybackTraceSink=null', () => {
    expect(getPlaybackTraceSink()).toBeNull();
    expect(isPlaybackTraceEnabled()).toBe(false);
  });

  it('注册/清除与既有接缝同构', () => {
    const sink = { onResolve: vi.fn() };
    setPlaybackTraceSink(sink);
    expect(getPlaybackTraceSink()).toBe(sink);
    expect(isPlaybackTraceEnabled()).toBe(true);
    setPlaybackTraceSink(null);
    expect(isPlaybackTraceEnabled()).toBe(false);
  });
});

describe('createPlaybackTraceRing（宿主常驻环形缓冲）', () => {
  const trace = (id: string): PlaybackTrace => ({
    ts: 1, songId: id, songName: id, artist: '', sourceType: 'netease', totalMs: 1,
    layer: 'direct', nonFull: false, prefetchHit: false, tier3Engaged: false, reason: '',
    via: 'direct', guard: null, directMs: 1, directMethod: 'resolvePlayableUrl',
    directSource: 'netease', tier3Ms: null, tier3TimedOut: false, sources: [],
  });

  it('容量上限丢最旧，clear 清空', () => {
    const ring = createPlaybackTraceRing(2);
    ring.sink.onResolve?.(trace('1'));
    ring.sink.onResolve?.(trace('2'));
    ring.sink.onResolve?.(trace('3'));
    expect(ring.listResolves().map((t) => t.songId)).toEqual(['2', '3']);
    ring.clear();
    expect(ring.listResolves()).toEqual([]);
    expect(ring.listProbes()).toEqual([]);
  });

  it('返回快照，外部修改不影响缓冲', () => {
    const ring = createPlaybackTraceRing(2);
    ring.sink.onResolve?.(trace('1'));
    ring.listResolves().pop();
    expect(ring.listResolves()).toHaveLength(1);
  });
});

describe('resolvePlayableSongRouted 落 trace', () => {
  it('直连成功：layer=direct、via=direct、guard=null、directMs 有值', async () => {
    registerDirectClient(makeClient('netease'));
    const traces: PlaybackTrace[] = [];
    setPlaybackTraceSink({ onResolve: (t) => traces.push(t) });

    const res = await resolvePlayableSongRouted(song('1'));
    expect(res.url).toBe('https://direct.example.com/1.mp3');
    expect(traces).toHaveLength(1);
    const t = traces[0];
    expect(t.layer).toBe('direct');
    expect(t.via).toBe('direct');
    expect(t.guard).toBeNull();
    expect(t.directMs).not.toBeNull();
    expect(t.directMethod).toBe('resolvePlayableUrl');
    expect(t.directSource).toBe('netease');
    expect(t.totalMs).toBeGreaterThanOrEqual(0);
    expect(t.tier3Engaged).toBe(false);
  });

  it('tier3 命中：layer=tier3、via/guard 透传、每源 leg 收进 sources', async () => {
    registerDirectClient(makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') }));
    setTier3Enabled(true);
    setTier3Resolver(async (_song, collect) => {
      collect?.({ sourceId: 'S1', ms: 12, outcome: 'hit', guard: 'audio-header' });
      return { url: 'https://tier3.example.com/x.mp3', guard: 'audio-header' };
    });
    const traces: PlaybackTrace[] = [];
    setPlaybackTraceSink({ onResolve: (t) => traces.push(t) });

    const res = await resolvePlayableSongRouted(song('1'));
    expect(res.url).toBe('https://tier3.example.com/x.mp3');
    expect(res.nonFull).toBe(false);
    const t = traces[0];
    expect(t.layer).toBe('tier3');
    expect(t.via).toBe('tier3');
    expect(t.guard).toBe('audio-header');
    expect(t.tier3Engaged).toBe(true);
    expect(t.tier3TimedOut).toBe(false);
    expect(t.tier3Ms).not.toBeNull();
    expect(t.sources).toEqual([{ sourceId: 'S1', ms: 12, outcome: 'hit', guard: 'audio-header' }]);
    expect(t.reason).toContain('无版权');
  });

  it('tier3 未命中：layer=fail、reason 保留触发原因、skipped leg 也在', async () => {
    registerDirectClient(makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') }));
    setTier3Enabled(true);
    setTier3Resolver(async (_song, collect) => {
      collect?.({ sourceId: 'S2', ms: 0, outcome: 'skipped' });
      return null;
    });
    const traces: PlaybackTrace[] = [];
    setPlaybackTraceSink({ onResolve: (t) => traces.push(t) });

    const res = await resolvePlayableSongRouted(song('1'));
    expect(res.url).toBe('');
    const t = traces[0];
    expect(t.layer).toBe('fail');
    expect(t.via).toBeNull();
    // resolver 正常返回 null（全源未命中）≠ 预算超时：只有后者才该把迟到命中记 discarded。
    expect(t.tier3TimedOut).toBe(false);
    expect(t.reason).toBe('直连返回空串（无版权/VIP）');
    expect(t.sources).toEqual([{ sourceId: 'S2', ms: 0, outcome: 'skipped' }]);
  });

  it('预取命中：layer=prefetch、0 次直连调用', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    setPrefetchedUrl(song('1'), 'https://prefetch.example.com/1.mp3', false);
    const traces: PlaybackTrace[] = [];
    setPlaybackTraceSink({ onResolve: (t) => traces.push(t) });

    const res = await resolvePlayableSongRouted(song('1'));
    expect(res.url).toBe('https://prefetch.example.com/1.mp3');
    expect(client.resolvePlayableUrl).not.toHaveBeenCalled();
    const t = traces[0];
    expect(t.layer).toBe('prefetch');
    expect(t.prefetchHit).toBe(true);
    expect(t.directMs).toBeNull();
    expect(t.reason).toBe('预取缓存命中');
  });

  it('sink 关闭：不构造 trace，也不给 resolver 传 collector（零成本）', async () => {
    registerDirectClient(makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') }));
    setTier3Enabled(true);
    let collectArg: unknown = 'unset';
    setTier3Resolver(async (_song, collect) => {
      collectArg = collect;
      return null;
    });
    setPlaybackTraceSink(null);

    await resolvePlayableSongRouted(song('1'));
    expect(collectArg).toBeUndefined();
  });
});

describe('probeSongsBatch 探测腿 trace', () => {
  it('resolveMs / validateMs 分开记，tag 透传', async () => {
    registerDirectClient(makeClient('netease'));
    vi.mocked(probeAudioUrl).mockResolvedValue('valid');
    const probes: PlaybackProbeTrace[] = [];
    setPlaybackTraceSink({ onProbe: (t) => probes.push(t) });

    const results = await musicApi.probeSongsBatch([song('1')]);
    expect(results).toEqual([{ songId: '1', tag: 'valid' }]);
    expect(probes).toHaveLength(1);
    expect(probes[0].songId).toBe('1');
    expect(probes[0].tag).toBe('valid');
    expect(probes[0].resolveMs).toBeGreaterThanOrEqual(0);
    expect(probes[0].validateMs).toBeGreaterThanOrEqual(0);
  });

  it('sink 关闭：不发射探测 trace', async () => {
    registerDirectClient(makeClient('netease'));
    vi.mocked(probeAudioUrl).mockResolvedValue('valid');
    setPlaybackTraceSink(null);
    await musicApi.probeSongsBatch([song('1')]);
    expect(probeAudioUrl).toHaveBeenCalledTimes(1);
  });
});
