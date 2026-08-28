import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import {
  registerDirectClient,
  getDirectClient,
  hasDirectClient,
  clearDirectClients,
  getSourceMode,
  setSourceMode,
  setSourceModes,
  getAllSourceModes,
  setSourceModePersister,
  searchSongsRouted,
  resolvePlayableUrlRouted,
  resolvePlayableSongRouted,
  setTier3Enabled,
  getTier3Enabled,
  setTier3Resolver,
  setTier3SearchEnabled,
  setTier3SearchResolver,
  type DirectSourceClient,
} from '../sourceRouter.js';

/**
 * 来源开关与回退链测试（T01 切片 2；#275 api 腿拆除后语义）。
 * 接缝 = core 路由层（searchSongsRouted / resolvePlayableUrlRouted）：
 * 注入 fake 直连客户端，验证 auto/direct 两态路由矩阵。自建 API 已退役：
 * 无客户端/无能力 = 「暂无直连实现」，直连失败且 tier3 未命中 = 上抛（D2）。
 */

const song = (id: string, source: string, url = ''): Song => ({
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
    searchSongs: vi.fn(async () => [song('direct-1', source)]),
    resolvePlayableUrl: vi.fn(async () => 'https://direct.example.com/1.mp3'),
    ...overrides,
  };
}

beforeEach(() => {
  clearDirectClients();
  setSourceModePersister(null);
  setSourceModes({});
  setTier3Enabled(false);
  setTier3Resolver(null);
  setTier3SearchEnabled(false);
  setTier3SearchResolver(null);
});

describe('直连客户端注册表', () => {
  it('注册后可取/可查，clear 后清空', () => {
    expect(hasDirectClient('netease')).toBe(false);
    const client = makeClient('netease');
    registerDirectClient(client);
    expect(hasDirectClient('netease')).toBe(true);
    expect(getDirectClient('netease')).toBe(client);
    clearDirectClients();
    expect(hasDirectClient('netease')).toBe(false);
  });
});

describe('来源开关', () => {
  it('默认 auto', () => {
    expect(getSourceMode('netease')).toBe('auto');
  });

  it('setSourceMode 单源设置并触发持久化回调（带完整 map）', () => {
    const persist = vi.fn();
    setSourceModePersister(persist);
    setSourceMode('netease', 'direct');
    expect(getSourceMode('netease')).toBe('direct');
    expect(persist).toHaveBeenCalledWith({ netease: 'direct' });
  });

  it('setSourceModes 批量替换并持久化；load 不触发持久化', () => {
    const persist = vi.fn();
    setSourceModePersister(persist);
    setSourceModes({ netease: 'direct', qq: 'api' });
    expect(getAllSourceModes()).toEqual({ netease: 'direct', qq: 'api' });
    expect(persist).toHaveBeenCalledTimes(1);

    persist.mockClear();
    setSourceModes({ qq: 'auto' });
    expect(getSourceMode('qq')).toBe('auto');
    expect(getSourceMode('netease')).toBe('auto'); // 替换而非合并
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('searchSongsRouted 路由矩阵', () => {
  it('auto + 无客户端 → tier3 搜索兜底未命中 → 报错「该源暂无直连实现」', async () => {
    await expect(searchSongsRouted('晴天', 1, 'netease')).rejects.toThrow('该源暂无直连实现');
  });

  it('auto + 客户端成功 → 走直连', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(client.searchSongs).toHaveBeenCalledWith('晴天', 1);
    expect(result[0].id).toBe('direct-1');
  });

  it('auto + 客户端失败 → tier3 未命中后原样上抛（D2）', async () => {
    const client = makeClient('netease', { searchSongs: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    await expect(searchSongsRouted('晴天', 1, 'netease')).rejects.toThrow('直连失败');
  });

  it('direct + 客户端成功 → 只走直连', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(client.searchSongs).toHaveBeenCalled();
    expect(result[0].id).toBe('direct-1');
  });

  it('direct + 客户端失败 → 错误上抛，不回退', async () => {
    const client = makeClient('netease', { searchSongs: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    await expect(searchSongsRouted('晴天', 1, 'netease')).rejects.toThrow('直连失败');
  });

  it('direct + 无客户端 → 明确报错「暂无直连实现」', async () => {
    setSourceMode('netease', 'direct');
    await expect(searchSongsRouted('晴天', 1, 'netease')).rejects.toThrow('暂无直连实现');
  });

  it('legacy api 模式（#277 收窄前）→ 无直连可用，报错「暂无直连实现」', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    setSourceMode('netease', 'api');
    await expect(searchSongsRouted('晴天', 1, 'netease')).rejects.toThrow('暂无直连实现');
    expect(client.searchSongs).not.toHaveBeenCalled();
  });

  it('direct + 客户端返回空 → tier3 搜索兜底返回候选', async () => {
    const tier3Search = vi.fn(async () => [song('tier3-1', 'netease')]);
    setTier3SearchEnabled(true);
    setTier3SearchResolver(tier3Search);
    const client = makeClient('netease', { searchSongs: vi.fn(async () => []) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    const result = await searchSongsRouted('陶喆', 1, 'netease');
    expect(tier3Search).toHaveBeenCalledWith('陶喆', 1, 'netease');
    expect(result[0].id).toBe('tier3-1');
  });

  it('auto + 客户端返回空且 tier3 未命中 → 返回空结果（搜索成功无命中，非失败）', async () => {
    const client = makeClient('netease', { searchSongs: vi.fn(async () => []) });
    registerDirectClient(client);
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(result).toEqual([]);
  });

  it('direct + 客户端失败 → tier3 搜索兜底返回候选，不回退', async () => {
    const tier3Search = vi.fn(async () => [song('tier3-1', 'netease')]);
    setTier3SearchEnabled(true);
    setTier3SearchResolver(tier3Search);
    const client = makeClient('netease', { searchSongs: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(tier3Search).toHaveBeenCalledWith('晴天', 1, 'netease');
    expect(result[0].id).toBe('tier3-1');
  });

  it('direct + 无客户端 → tier3 搜索兜底返回候选，不再直接报错', async () => {
    const tier3Search = vi.fn(async () => [song('tier3-1', 'netease')]);
    setTier3SearchEnabled(true);
    setTier3SearchResolver(tier3Search);
    setSourceMode('netease', 'direct');
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(result[0].id).toBe('tier3-1');
  });
});

describe('resolvePlayableUrlRouted 路由矩阵', () => {
  it('auto + 客户端返回直链 → 直链返回', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease'));
    expect(client.resolvePlayableUrl).toHaveBeenCalled();
    expect(url).toBe('https://direct.example.com/1.mp3');
  });

  it('auto + 客户端返回空串（无版权/VIP）→ 原样返回空串，交换元层', async () => {
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease'));
    expect(url).toBe('');
  });

  it('auto + 客户端失败 → tier3 未命中后上抛（D2）', async () => {
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    await expect(resolvePlayableUrlRouted(song('1', 'netease'))).rejects.toThrow('直连失败');
  });

  it('direct + 客户端失败 → 上抛，不回退', async () => {
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    await expect(resolvePlayableUrlRouted(song('1', 'netease'))).rejects.toThrow('直连失败');
  });

  it('direct + 无客户端 → 明确报错', async () => {
    setSourceMode('netease', 'direct');
    await expect(resolvePlayableUrlRouted(song('1', 'netease'))).rejects.toThrow('暂无直连实现');
  });

  it('auto + 无客户端 → 明确报错（api 腿已拆除，#275）', async () => {
    await expect(resolvePlayableUrlRouted(song('1', 'netease'))).rejects.toThrow('暂无直连实现');
  });
});

describe('tier3 插槽（预留：默认关，未注入不生效；#144 落地后启用）', () => {
  it('默认关闭且无 resolver', () => {
    expect(getTier3Enabled()).toBe(false);
  });

  it('关闭时即使注入 resolver 也不调用（行为与现状一致）', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    await expect(resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'))).rejects.toThrow('直连失败');
    expect(tier3).not.toHaveBeenCalled();
  });

  it('开启 + resolver：直连失败后走 tier3，不再上抛', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'));
    expect(tier3).toHaveBeenCalled();
    expect(url).toBe('https://tier3.example.com/1.mp3');
  });

  it('开启但 resolver 返回空/抛错 → tier3 未命中后上抛（D2）', async () => {
    setTier3Enabled(true);
    setTier3Resolver(vi.fn(async () => ''));
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    await expect(resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'))).rejects.toThrow('直连失败');
  });

  it('开启 + resolver：直连返回空（无版权/VIP）也走 tier3，不返回空串', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease'));
    expect(tier3).toHaveBeenCalled();
    expect(url).toBe('https://tier3.example.com/1.mp3');
  });

  it('开启 + resolver 也返回空：直连空串原样返回（交换元层）', async () => {
    const tier3 = vi.fn(async () => '');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease'));
    expect(tier3).toHaveBeenCalled();
    expect(url).toBe('');
  });

  it('direct 模式不经过 tier3（直连失败直接上抛）', async () => {
    setTier3Enabled(true);
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    await expect(resolvePlayableUrlRouted(song('1', 'netease'))).rejects.toThrow('直连失败');
    expect(tier3).not.toHaveBeenCalled();
  });

  it('开启 + resolver：直连返回非空但 audioTag=invalid 时也走 tier3', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => 'https://direct.example.com/1.mp3') });
    registerDirectClient(client);
    const invalidSong = { ...song('1', 'netease'), audioTag: 'invalid' as const };
    const url = await resolvePlayableUrlRouted(invalidSong);
    expect(tier3).toHaveBeenCalled();
    expect(url).toBe('https://tier3.example.com/1.mp3');
  });

  it('未配置 tier3：audioTag=invalid 时保留直连 URL（由上层继续弹窗/换元）', async () => {
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => 'https://direct.example.com/1.mp3') });
    registerDirectClient(client);
    const invalidSong = { ...song('1', 'netease'), audioTag: 'invalid' as const };
    const url = await resolvePlayableUrlRouted(invalidSong);
    expect(url).toBe('https://direct.example.com/1.mp3');
  });
});

describe('tier3 同歌去重（#172 评论：同歌并行重复解析）', () => {
  /** 直连返回空串 + tier3 兜底启用的环境：resolvePlayableSongRouted 必经 tier3 腿 */
  function setupEmptyDirect(): void {
    registerDirectClient(makeClient('qq', { resolvePlayableUrl: vi.fn(async () => '') }));
    setTier3Enabled(true);
  }

  it('同歌并发解析只调用一次 resolver，两个调用方拿到同一结果', async () => {
    setupEmptyDirect();
    let resolveTier3!: (v: string) => void;
    const tier3 = vi.fn(
      () => new Promise<string>((r) => { resolveTier3 = r; })
    );
    setTier3Resolver(tier3);

    const s = song('001abc', 'qq');
    const p1 = resolvePlayableSongRouted(s);
    const p2 = resolvePlayableSongRouted(s);
    // 让两条调用都进入 tier3 腿
    await vi.waitFor(() => expect(tier3).toHaveBeenCalledTimes(1));
    resolveTier3('https://tier3.example.com/shared.m4a');

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(tier3).toHaveBeenCalledTimes(1); // 上游只被打一次
    expect(r1.url).toBe('https://tier3.example.com/shared.m4a');
    expect(r2.url).toBe('https://tier3.example.com/shared.m4a');
  });

  it('不同歌并发各自解析，互不共享', async () => {
    setupEmptyDirect();
    const tier3 = vi.fn(async (_s: Song) => `https://tier3.example.com/${_s.id}.m4a`);
    setTier3Resolver(tier3);

    const [r1, r2] = await Promise.all([
      resolvePlayableSongRouted(song('a', 'qq')),
      resolvePlayableSongRouted(song('b', 'qq')),
    ]);
    expect(tier3).toHaveBeenCalledTimes(2);
    expect(r1.url).toBe('https://tier3.example.com/a.m4a');
    expect(r2.url).toBe('https://tier3.example.com/b.m4a');
  });

  it('底层 Promise 结束后键移除：再次解析重新发起，不做结果缓存', async () => {
    setupEmptyDirect();
    const tier3 = vi.fn(async () => 'https://tier3.example.com/x.mp3');
    setTier3Resolver(tier3);

    await resolvePlayableSongRouted(song('x', 'qq'));
    await resolvePlayableSongRouted(song('x', 'qq'));
    expect(tier3).toHaveBeenCalledTimes(2);
  });

  it('预算超时不污染共享链：超时方拿空串，底层迟到命中后键被清理', async () => {
    setupEmptyDirect();
    vi.useFakeTimers();
    try {
      let resolveTier3!: (v: string) => void;
      const tier3 = vi.fn(
        () => new Promise<string>((r) => { resolveTier3 = r; })
      );
      setTier3Resolver(tier3);

      const first = resolvePlayableSongRouted(song('slow', 'qq'));
      await vi.advanceTimersByTimeAsync(1);
      expect(tier3).toHaveBeenCalledTimes(1);
      // 预算（6s）耗尽 → 第一位按未命中处理（底层继续跑）
      await vi.advanceTimersByTimeAsync(6_000);
      expect((await first).url).toBe('');
      expect(tier3).toHaveBeenCalledTimes(1); // 底层未被中断

      // 底层迟到命中 → finally 清键
      resolveTier3('https://tier3.example.com/late.m4a');
      await vi.advanceTimersByTimeAsync(1);

      // 键已清：后续调用重新发起，不会接住已结束的旧 Promise
      const second = resolvePlayableSongRouted(song('slow', 'qq'));
      // 第二次调用的预算同样走完（resolver 未命中 → 空串）
      await vi.advanceTimersByTimeAsync(6_000);
      expect((await second).url).toBe('');
      expect(tier3).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
