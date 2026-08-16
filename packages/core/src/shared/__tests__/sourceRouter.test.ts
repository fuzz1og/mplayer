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
  configureSourceRouter,
  searchSongsRouted,
  resolvePlayableUrlRouted,
  setTier3Enabled,
  getTier3Enabled,
  setTier3Resolver,
  setTier3SearchEnabled,
  setTier3SearchResolver,
  type DirectSourceClient,
} from '../sourceRouter.js';

/**
 * 来源开关与回退链测试（T01 切片 2）。
 * 接缝 = core 路由层（searchSongsRouted / resolvePlayableUrlRouted）：
 * 注入 fake 直连客户端 + mock api 腿，验证 auto/direct/api 三态路由矩阵，
 * 不断言内部实现。api 腿即「自建 API」现状语义。
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

let apiSearch: ReturnType<typeof vi.fn>;
let apiGetAudioUrl: ReturnType<typeof vi.fn>;

function makeClient(source: string, overrides: Partial<DirectSourceClient> = {}): DirectSourceClient {
  return {
    key: source as DirectSourceClient['key'],
    search: vi.fn(async () => [song('direct-1', source)]),
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
  apiSearch = vi.fn(async (_q: string, _p: number, _s: string) => [song('api-1', 'netease')]);
  apiGetAudioUrl = vi.fn(async (_url: string) => 'https://api.example.com/1.mp3');
  configureSourceRouter({ searchSongs: apiSearch, getAudioUrl: apiGetAudioUrl });
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
  it('auto + 无客户端 → 走 api 腿（现状等价）', async () => {
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(apiSearch).toHaveBeenCalledWith('晴天', 1, 'netease');
    expect(result[0].id).toBe('api-1');
  });

  it('auto + 客户端成功 → 走直连，api 不调用', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(client.search).toHaveBeenCalledWith('晴天', 1);
    expect(apiSearch).not.toHaveBeenCalled();
    expect(result[0].id).toBe('direct-1');
  });

  it('auto + 客户端失败 → 回退 api 腿', async () => {
    const client = makeClient('netease', { search: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(apiSearch).toHaveBeenCalledWith('晴天', 1, 'netease');
    expect(result[0].id).toBe('api-1');
  });

  it('direct + 客户端成功 → 只走直连', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(client.search).toHaveBeenCalled();
    expect(apiSearch).not.toHaveBeenCalled();
    expect(result[0].id).toBe('direct-1');
  });

  it('direct + 客户端失败 → 错误上抛，不回退 api', async () => {
    const client = makeClient('netease', { search: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    await expect(searchSongsRouted('晴天', 1, 'netease')).rejects.toThrow('直连失败');
    expect(apiSearch).not.toHaveBeenCalled();
  });

  it('direct + 无客户端 → 明确报错「暂无直连实现」', async () => {
    setSourceMode('netease', 'direct');
    await expect(searchSongsRouted('晴天', 1, 'netease')).rejects.toThrow('暂无直连实现');
    expect(apiSearch).not.toHaveBeenCalled();
  });

  it('api 模式 → 即使有客户端也只走 api', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    setSourceMode('netease', 'api');
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(apiSearch).toHaveBeenCalled();
    expect(client.search).not.toHaveBeenCalled();
    expect(result[0].id).toBe('api-1');
  });

  it('direct + 客户端返回空 → tier3 搜索兜底返回候选，不回退 api', async () => {
    const tier3Search = vi.fn(async () => [song('tier3-1', 'netease')]);
    setTier3SearchEnabled(true);
    setTier3SearchResolver(tier3Search);
    const client = makeClient('netease', { search: vi.fn(async () => []) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    const result = await searchSongsRouted('陶喆', 1, 'netease');
    expect(tier3Search).toHaveBeenCalledWith('陶喆', 1, 'netease');
    expect(result[0].id).toBe('tier3-1');
    expect(apiSearch).not.toHaveBeenCalled();
  });

  it('direct + 客户端失败 → tier3 搜索兜底返回候选，不回退 api', async () => {
    const tier3Search = vi.fn(async () => [song('tier3-1', 'netease')]);
    setTier3SearchEnabled(true);
    setTier3SearchResolver(tier3Search);
    const client = makeClient('netease', { search: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(tier3Search).toHaveBeenCalledWith('晴天', 1, 'netease');
    expect(result[0].id).toBe('tier3-1');
    expect(apiSearch).not.toHaveBeenCalled();
  });

  it('direct + 无客户端 → tier3 搜索兜底返回候选，不再直接报错', async () => {
    const tier3Search = vi.fn(async () => [song('tier3-1', 'netease')]);
    setTier3SearchEnabled(true);
    setTier3SearchResolver(tier3Search);
    setSourceMode('netease', 'direct');
    const result = await searchSongsRouted('晴天', 1, 'netease');
    expect(result[0].id).toBe('tier3-1');
    expect(apiSearch).not.toHaveBeenCalled();
  });
});

describe('resolvePlayableUrlRouted 路由矩阵', () => {
  it('auto + 客户端返回直链 → 直链返回，api 不调用', async () => {
    const client = makeClient('netease');
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease'));
    expect(client.resolvePlayableUrl).toHaveBeenCalled();
    expect(apiGetAudioUrl).not.toHaveBeenCalled();
    expect(url).toBe('https://direct.example.com/1.mp3');
  });

  it('auto + 客户端返回空串（无版权/VIP）→ 原样返回空串，交换元层，不回退 api', async () => {
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease'));
    expect(url).toBe('');
    expect(apiGetAudioUrl).not.toHaveBeenCalled();
  });

  it('auto + 客户端失败 → 回退 api getAudioUrl', async () => {
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'));
    expect(apiGetAudioUrl).toHaveBeenCalledWith('https://x/api.mp3');
    expect(url).toBe('https://api.example.com/1.mp3');
  });

  it('direct + 客户端失败 → 上抛，不回退 api', async () => {
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    setSourceMode('netease', 'direct');
    await expect(resolvePlayableUrlRouted(song('1', 'netease'))).rejects.toThrow('直连失败');
    expect(apiGetAudioUrl).not.toHaveBeenCalled();
  });

  it('direct + 无客户端 → 明确报错', async () => {
    setSourceMode('netease', 'direct');
    await expect(resolvePlayableUrlRouted(song('1', 'netease'))).rejects.toThrow('暂无直连实现');
    expect(apiGetAudioUrl).not.toHaveBeenCalled();
  });

  it('api 模式 → 直接走 api getAudioUrl', async () => {
    registerDirectClient(makeClient('netease'));
    setSourceMode('netease', 'api');
    const url = await resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'));
    expect(apiGetAudioUrl).toHaveBeenCalledWith('https://x/api.mp3');
    expect(url).toBe('https://api.example.com/1.mp3');
  });

  it('auto + 无客户端 → 走 api getAudioUrl（现状等价）', async () => {
    const url = await resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'));
    expect(apiGetAudioUrl).toHaveBeenCalledWith('https://x/api.mp3');
    expect(url).toBe('https://api.example.com/1.mp3');
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
    const url = await resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'));
    expect(tier3).not.toHaveBeenCalled();
    expect(apiGetAudioUrl).toHaveBeenCalledWith('https://x/api.mp3');
    expect(url).toBe('https://api.example.com/1.mp3');
  });

  it('开启 + resolver：直连失败后走 tier3，不再回退 api', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'));
    expect(tier3).toHaveBeenCalled();
    expect(apiGetAudioUrl).not.toHaveBeenCalled();
    expect(url).toBe('https://tier3.example.com/1.mp3');
  });

  it('开启但 resolver 返回空/抛错 → 回退 api 腿', async () => {
    setTier3Enabled(true);
    setTier3Resolver(vi.fn(async () => ''));
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => { throw new Error('直连失败'); }) });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease', 'https://x/api.mp3'));
    expect(apiGetAudioUrl).toHaveBeenCalledWith('https://x/api.mp3');
    expect(url).toBe('https://api.example.com/1.mp3');
  });

  it('开启 + resolver：直连返回空（无版权/VIP）也走 tier3，不再回退 api/空串', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/1.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease'));
    expect(tier3).toHaveBeenCalled();
    expect(apiGetAudioUrl).not.toHaveBeenCalled();
    expect(url).toBe('https://tier3.example.com/1.mp3');
  });

  it('开启 + resolver 也返回空：直连空串原样返回（交换元层，不回退 api）', async () => {
    const tier3 = vi.fn(async () => '');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    const client = makeClient('netease', { resolvePlayableUrl: vi.fn(async () => '') });
    registerDirectClient(client);
    const url = await resolvePlayableUrlRouted(song('1', 'netease'));
    expect(tier3).toHaveBeenCalled();
    expect(apiGetAudioUrl).not.toHaveBeenCalled();
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
    expect(apiGetAudioUrl).not.toHaveBeenCalled();
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
