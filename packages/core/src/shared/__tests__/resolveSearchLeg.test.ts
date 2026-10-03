import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import {
  registerDirectClient,
  clearDirectClients,
  resolvePlayableSongRouted,
  clearPrefetchCache,
  setPlaybackTraceSink,
  setTier3Enabled,
  setTier3Resolver,
  type PlaybackTrace,
  type DirectSourceClient,
} from '../../index.js';
import { SEARCH_LEG_WALL_MS } from '../playbackBudgets.js';

const song = (over: Partial<Song> = {}): Song => ({
  id: 'netease:1',
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 240,
  sourceType: 'netease',
  ...over,
});

/** 搜索候选：与目标歌同名同歌手（过 findExactMatch），带一个可用直链。 */
const hit = (over: Partial<Song> = {}): Song =>
  song({ id: 'netease:hit', url: 'https://cdn.example.com/full.mp3', ...over });

/** 直连恒返回空串（无版权/VIP）→ 解析链必然落到搜索腿。 */
const emptyClient: DirectSourceClient = {
  key: 'netease',
  resolvePlayableUrl: async () => '',
};

/**
 * #544：解析链的**严格搜索腿**。
 *
 * 此前这条规则在桌面被手抄成「搜索 → findExactMatch → 取 hit.url」，
 * 缺三条守卫（非 http / 旧签名死链 / audioTag=invalid）也不写缓存；
 * core 的 `refreshSongResource` 一直有完整规则却只有 1 个消费者。
 * 这里用矩阵钉死守卫，证明「弱化手抄」与「core 唯一实现」的差别真实存在。
 */
describe('解析链严格搜索腿（#544）', () => {
  beforeEach(() => {
    clearDirectClients();
    clearPrefetchCache();
  });

  /** #556：搜索腿的端口是直连客户端的 searchSongs（不再是 setStrictSearch 模块级插槽）。 */
  function registerEmptyClientWithSearch(searchSongs: DirectSourceClient['searchSongs']): void {
    registerDirectClient({ ...emptyClient, searchSongs });
  }

  it('直连空串 + 精确匹配命中 → 拿到 URL', async () => {
    registerEmptyClientWithSearch(async () => [hit()]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('https://cdn.example.com/full.mp3');
    expect(res.via).toBe('direct'); // 搜索腿拿到的仍是该源直链
    expect(res.nonFull).toBe(false);
  });

  it('守卫：候选是旧签名死链 → 不采用（手抄版会采用）', async () => {
    registerEmptyClientWithSearch(async () => [
      song({ id: 'netease:dead', url: 'https://api.example.com/api.php?get=url&id=1' }),
    ]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('');
  });

  it('守卫：候选 audioTag=invalid → 不采用（手抄版会采用）', async () => {
    registerEmptyClientWithSearch(async () => [
      song({ id: 'netease:bad', url: 'https://cdn.example.com/bad.mp3', audioTag: 'invalid' }),
    ]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('');
  });

  it('守卫：候选 url 非 http → 不采用（手抄版会采用）', async () => {
    registerEmptyClientWithSearch(async () => [song({ id: 'netease:rel', url: '/relative/path.mp3' })]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('');
  });

  it('nonFull 保留：候选是试听版 → 结果带 nonFull=true（手抄版会丢）', async () => {
    registerEmptyClientWithSearch(async () => [hit({ id: 'netease:trial', url: 'https://cdn.example.com/trial.mp3', audioTag: 'preview' })]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('https://cdn.example.com/trial.mp3');
    expect(res.nonFull).toBe(true);
  });

  it('采用后写回预取缓存 → 第二次解析不再搜索（手抄版不写缓存）', async () => {
    let searches = 0;
    registerEmptyClientWithSearch(async () => {
      searches += 1;
      return [hit()];
    });
    await resolvePlayableSongRouted(song());
    expect(searches).toBe(1);
    const again = await resolvePlayableSongRouted(song());
    expect(again.url).toBe('https://cdn.example.com/full.mp3');
    expect(searches).toBe(1); // 预取缓存命中，没再搜索
  });

  it('搜索抛错 → 失败打开，返回空 url 而不抛', async () => {
    registerEmptyClientWithSearch(async () => {
      throw new Error('搜索炸了');
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('');
  });

  it('本地文件不走搜索腿', async () => {
    let called = 0;
    registerEmptyClientWithSearch(async () => {
      called += 1;
      return [hit()];
    });
    await resolvePlayableSongRouted(song({ sourceType: 'local' })).catch(() => null);
    expect(called).toBe(0);
  });
});

/**
 * #556：搜索腿此前**只挂在「直连返回空串」这一条分支**上——直连抛错（含
 * `direct-unavailable`）的 catch 分支 tier3 未命中后直接上抛，宿主只能自己补一份。
 * 现在两个分支都落到同一条尾巴，且各自只搜一次。
 */
describe('解析链搜索腿覆盖两条入口分支（#556）', () => {
  beforeEach(() => {
    clearDirectClients();
    clearPrefetchCache();
  });

  it('直连返回空串 → 走搜索腿，searchSongs 只调用一次', async () => {
    const searchSongs = vi.fn(async () => [hit()]);
    registerDirectClient({ key: 'netease', resolvePlayableUrl: async () => '', searchSongs });

    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('https://cdn.example.com/full.mp3');
    expect(searchSongs).toHaveBeenCalledTimes(1);
  });

  it('直连抛错 + 搜索命中 → 走搜索腿交付 URL（此前直接上抛）', async () => {
    const searchSongs = vi.fn(async () => [hit()]);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: async () => {
        throw new Error('直连炸了');
      },
      searchSongs,
    });

    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('https://cdn.example.com/full.mp3');
    expect(res.via).toBe('direct');
    expect(searchSongs).toHaveBeenCalledTimes(1);
  });

  // 本测试证明的是**端口语义**：腿墙到点时编排把 abort 交给搜索端口（假实现据此取消）。
  // 「底层请求真的被停」由 searchSongsOptsWiring.test.ts 从各源 transport 行为上钉住。
  it('搜索腿到点 → 编排把 abort 交给搜索端口', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      registerDirectClient({
        key: 'netease',
        resolvePlayableUrl: async () => '',
        searchSongs: (_keyword, _page, opts) =>
          new Promise<Song[]>((_resolve, reject) => {
            opts?.signal?.addEventListener?.('abort', () => {
              aborted = true;
              reject(new Error('搜索被取消'));
            });
          }),
      });

      const pending = resolvePlayableSongRouted(song());
      await vi.advanceTimersByTimeAsync(SEARCH_LEG_WALL_MS);
      const res = await pending;
      expect(res.url).toBe('');
      // 墙到点 = 真的 abort 底层搜索（不是「放弃等待但请求继续跑」）。
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('搜索腿墙取 min(本腿墙, 链总预算剩余)：预算更小时按预算截断', async () => {
    vi.useFakeTimers();
    try {
      let seenTimeoutMs: number | undefined;
      registerDirectClient({
        key: 'netease',
        // 直连吃掉 2s（在 3s 直连墙内），留给搜索腿的只剩 ~2s < 2.5s 腿墙
        resolvePlayableUrl: () => new Promise<string>((resolve) => setTimeout(() => resolve(''), 2_000)),
        searchSongs: (_keyword, _page, opts) => {
          seenTimeoutMs = opts?.timeoutMs;
          return Promise.resolve([]);
        },
      });

      const pending = resolvePlayableSongRouted(song(), { budgetMs: 4_000 });
      await vi.advanceTimersByTimeAsync(3_000);
      await pending;
      expect(seenTimeoutMs).toBeGreaterThan(0);
      expect(seenTimeoutMs!).toBeLessThan(SEARCH_LEG_WALL_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('直连抛错 + 搜索未命中 → 上抛的是**原错误对象**（搜索腿不得吞错/换错）', async () => {
    const original = new Error('直连炸了');
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: async () => {
        throw original;
      },
      searchSongs: async () => [],
    });

    await expect(resolvePlayableSongRouted(song())).rejects.toBe(original);
  });
});

/**
 * #556：搜索腿的 trace 身份与链总预算口径——这条腿此前**不在 trace 里**
 * （丢弃映射只遍历 ctx.legs），且不受整链预算约束。
 */
describe('搜索腿的 trace 记录与链总预算（#556）', () => {
  beforeEach(() => {
    clearDirectClients();
    clearPrefetchCache();
    setPlaybackTraceSink(null);
    setTier3Enabled(false);
    setTier3Resolver(null);
  });

  it('搜索腿命中 → sources 里出现一条 search:<源> 的 hit leg', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: async () => '',
      searchSongs: async () => [hit()],
    });
    const traces: PlaybackTrace[] = [];
    setPlaybackTraceSink({ onResolve: (t) => traces.push(t) });

    await resolvePlayableSongRouted(song());
    expect(traces[0].sources).toContainEqual(
      expect.objectContaining({ sourceId: 'search:netease', outcome: 'hit' }),
    );
    setPlaybackTraceSink(null);
  });

  it('链总预算已耗尽 → 连搜索都不发起（与 tier3 腿同口径）', async () => {
    const searchSongs = vi.fn(async () => [hit()]);
    registerDirectClient({
      key: 'netease',
      // 直连吃满 3s 直连墙（墙到点抛错），此时 1s 的链总预算早已耗尽
      resolvePlayableUrl: () => new Promise<string>((resolve) => setTimeout(() => resolve(''), 5_000)),
      searchSongs,
    });

    await expect(
      resolvePlayableSongRouted(song(), { budgetMs: 1_000 }),
    ).rejects.toThrow();
    expect(searchSongs).not.toHaveBeenCalled();
  }, 15_000);
});
