import { describe, it, expect, afterEach, vi } from 'vitest';
import { setTransport, type TransportRequest } from '../transport.js';
import { createNeteaseDirectClient } from '../neteaseDirect.js';
import type { ContentCache } from '../../shared/sourceRouter.js';

/**
 * 网易歌单搜索（#415 / ADR `2026-09-27-netease-playlist-search`）单测。
 *
 * 接缝 = `setTransport`（`transport.request` 是唯一出网口），**零真实网络**；
 * 模式与 `neteaseContent.test.ts` 一致（fakeCache + mockTransport + afterEach 复位）。
 *
 * 覆盖：请求形态（URL/表单/头集合与 searchSongs 逐字一致，不新增加密）、字段映射、
 * 分页与越界、limit 钳制、`code=405/406/400` 错误路径、空关键词零请求、
 * 缓存（key/TTL 6h/空结果不入库）与单飞；以及 `searchArtists` 迁腿后的可区分失败语义。
 */

afterEach(() => {
  setTransport(null);
  vi.restoreAllMocks();
});

const CLOUDSEARCH = 'https://music.163.com/api/cloudsearch/pc';

/** 内存假缓存（记 TTL，用于断言 6h 档位与「空结果不缓存」）。 */
function fakeCache(): ContentCache & { store: Map<string, { data: unknown; ttlMs: number }> } {
  const store = new Map<string, { data: unknown; ttlMs: number }>();
  return {
    store,
    get: <T,>(key: string) => (store.has(key) ? (store.get(key)!.data as T) : null),
    set: <T,>(key: string, data: T, ttlMs: number) => {
      store.set(key, { data, ttlMs });
    },
  };
}

type Responder = (req: TransportRequest) => { status: number; body: string };

function mockTransport(routes: { match: (url: string) => boolean; respond: Responder }[]): TransportRequest[] {
  const seen: TransportRequest[] = [];
  setTransport(async (req) => {
    seen.push(req);
    const route = routes.find((r) => r.match(req.url));
    if (!route) throw new Error(`unexpected request: ${req.url}`);
    const { status, body } = route.respond(req);
    return { status, headers: { 'content-type': 'application/json' }, body, finalUrl: req.url };
  });
  return seen;
}

const json = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });
const cloudsearch = { match: (u: string) => u.includes('/api/cloudsearch/pc') };
/** 请求体 form 解析（调用方断言参数，不解析就不知道发了什么）。 */
const form = (req: TransportRequest) => new URLSearchParams(req.body || '');

/** 上游歌单对象样板（字段取自 2026-09-25 线上实测响应）。 */
function rawPlaylist(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 6792103822,
    name: '周杰伦-Jay 『网易云精选』',
    coverImgUrl: 'http://p1.music.126.net/WFQ4EKF5QabD33U3NUOPWQ==/109951169535051638.jpg',
    trackCount: 144,
    playCount: 33251026,
    creator: { nickname: 'Buradarrr', userId: 361038766 },
    description: '【持续更新】欢迎投稿…',
    ...over,
  };
}

describe('neteaseDirect.searchPlaylists（#415 歌单搜索）', () => {
  it('请求形态：POST cloudsearch/pc，form s/type=1000/limit/offset；头集合与 searchSongs 逐字一致（不新增头/不新增加密）', async () => {
    const seen = mockTransport([
      { ...cloudsearch, respond: () => json({ code: 200, result: { playlists: [rawPlaylist()], playlistCount: 465 } }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());

    await client.searchPlaylists!('周杰伦', 5);
    await client.searchSongs!('周杰伦', 1);

    const [plReq, songReq] = seen;
    expect(plReq.method).toBe('POST');
    expect(plReq.url).toBe(CLOUDSEARCH);
    const q = form(plReq);
    expect([...q.keys()]).toEqual(['s', 'type', 'limit', 'offset']);
    expect(q.get('s')).toBe('周杰伦');
    expect(q.get('type')).toBe('1000');
    expect(q.get('limit')).toBe('5');
    expect(q.get('offset')).toBe('0');

    // 「不新增请求头」：与同腿的 searchSongs 头集合完全相同（不是「差不多」）
    expect(Object.keys(plReq.headers ?? {}).sort()).toEqual(Object.keys(songReq.headers ?? {}).sort());
    expect(plReq.headers!['content-type']).toBe('application/x-www-form-urlencoded');
    expect(plReq.headers!['Referer']).toBe('https://music.163.com/');
    // UA 走既有的池（每次可能不同），这里只断言「有」——头集合相等已覆盖「不新增头」
    expect(plReq.headers!['User-Agent']).toBeTruthy();
    // 「不新增签名/加密」：body 里没有 weapi 的两个加密参数
    expect(q.get('params')).toBeNull();
    expect(q.get('encSecKey')).toBeNull();
  });

  it('字段映射：id/name/playCount/trackCount/creator.nickname/description 直取；tags 补 []、coverImgUrl 转 https、creator 与数值兜底', async () => {
    mockTransport([
      {
        ...cloudsearch,
        respond: () =>
          json({
            code: 200,
            result: {
              playlists: [
                rawPlaylist(),
                rawPlaylist({
                  id: 2,
                  name: '',
                  coverImgUrl: undefined,
                  playCount: undefined,
                  trackCount: undefined,
                  creator: null,
                  description: undefined,
                }),
              ],
              playlistCount: 465,
            },
          }),
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const page = await client.searchPlaylists!('周杰伦', 30);

    expect(page.playlists[0]).toEqual({
      id: 6792103822,
      name: '周杰伦-Jay 『网易云精选』',
      coverImgUrl: 'https://p1.music.126.net/WFQ4EKF5QabD33U3NUOPWQ==/109951169535051638.jpg',
      playCount: 33251026,
      trackCount: 144,
      creator: { nickname: 'Buradarrr' },
      tags: [],
      description: '【持续更新】欢迎投稿…',
    });
    // creator 为空 / 数值缺失 / 封面缺失 的兜底（上游确实会缺）
    expect(page.playlists[1]).toMatchObject({
      id: 2,
      coverImgUrl: '',
      playCount: 0,
      trackCount: 0,
      creator: { nickname: '' },
      tags: [],
      description: '',
    });
    expect(page.total).toBe(465);
  });

  it('分页：more = offset + limit < playlistCount；offset 越界（playlistCount=0）视为到底不是错误；limit 钳制 ≤100', async () => {
    const seen = mockTransport([
      {
        ...cloudsearch,
        respond: (req) => {
          const offset = Number(form(req).get('offset'));
          if (offset >= 990) return json({ code: 200, result: { playlists: [], playlistCount: 0 } });
          return json({ code: 200, result: { playlists: [rawPlaylist({ id: offset + 1 })], playlistCount: 12 } });
        },
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());

    // 5 + 5 < 12 → 还有下一页
    expect((await client.searchPlaylists!('助眠', 5, 5)).more).toBe(true);
    // 10 + 5 >= 12 → 到底
    expect((await client.searchPlaylists!('助眠', 5, 10)).more).toBe(false);
    // 越界：上游 code=200 但 playlistCount=0 → 到底，且**不抛错**
    await expect(client.searchPlaylists!('助眠', 30, 990)).resolves.toEqual({ playlists: [], total: 0, more: false });
    // limit>100 上游会 code=400 → core 内部钳制，正常路径上打不出这个 400
    await client.searchPlaylists!('助眠', 200);
    expect(form(seen[3]).get('limit')).toBe('100');
    // limit 非法值兜底到 1
    await client.searchPlaylists!('助眠', 0);
    expect(form(seen[4]).get('limit')).toBe('1');
  });

  it('错误路径：code=405/406/400 一律抛错且错误里带 code（不再静默空数组）', async () => {
    let code = 405;
    mockTransport([{ ...cloudsearch, respond: () => json({ code, message: '操作频繁，请稍候再试' }) }]);
    const client = createNeteaseDirectClient(fakeCache());

    await expect(client.searchPlaylists!('限流1', 30)).rejects.toThrow(/405/);
    code = 406;
    await expect(client.searchPlaylists!('限流2', 30)).rejects.toThrow(/406/);
    code = 400;
    await expect(client.searchPlaylists!('限流3', 30)).rejects.toThrow(/400/);
    code = 500;
    await expect(client.searchPlaylists!('限流4', 30)).rejects.toThrow(/500/);
  });

  it('空关键词（含纯空白）：本地拒绝并抛可区分错误，零请求（上游空 s 也是 code=400）', async () => {
    const seen = mockTransport([
      { ...cloudsearch, respond: () => json({ code: 200, result: { playlists: [], playlistCount: 0 } }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());

    await expect(client.searchPlaylists!('', 30)).rejects.toThrow(/关键词/);
    await expect(client.searchPlaylists!('   ', 30)).rejects.toThrow(/关键词/);
    expect(seen).toHaveLength(0);
  });

  it('缓存：key 含关键词+limit+offset、TTL 6h、命中零请求；空结果不缓存', async () => {
    let calls = 0;
    mockTransport([
      {
        ...cloudsearch,
        respond: (req) => {
          calls++;
          const offset = Number(form(req).get('offset'));
          if (offset >= 990) return json({ code: 200, result: { playlists: [], playlistCount: 0 } });
          return json({ code: 200, result: { playlists: [rawPlaylist()], playlistCount: 465 } });
        },
      },
    ]);
    const cache = fakeCache();
    const client = createNeteaseDirectClient(cache);

    await client.searchPlaylists!('周杰伦', 30, 0);
    await client.searchPlaylists!('周杰伦', 30, 0); // 命中缓存 → 零请求
    expect(calls).toBe(1);
    await client.searchPlaylists!('周杰伦', 30, 30); // 不同 offset → 不同 key → 新请求
    expect(calls).toBe(2);

    expect(cache.store.get('search_playlists_周杰伦_30_0')?.ttlMs).toBe(6 * 60 * 60 * 1000);

    await client.searchPlaylists!('周杰伦', 30, 990); // 越界到底：空结果
    expect(cache.store.has('search_playlists_周杰伦_30_990')).toBe(false); // 空结果不入库（保留下次自愈）
  });

  it('单飞：同键并发只打一发上游；不同键各打一发', async () => {
    const gates: (() => void)[] = [];
    const seen: TransportRequest[] = [];
    setTransport(async (req) => {
      seen.push(req);
      await new Promise<void>((resolve) => gates.push(resolve));
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ code: 200, result: { playlists: [rawPlaylist()], playlistCount: 465 } }),
        finalUrl: req.url,
      };
    });
    const client = createNeteaseDirectClient(fakeCache());
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    const p1 = client.searchPlaylists!('并发', 30);
    const p2 = client.searchPlaylists!('并发', 30);
    await tick();
    expect(seen).toHaveLength(1); // 同键：第二发复用在飞 promise，不重复出网
    gates.splice(0).forEach((g) => g());
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);

    const p3 = client.searchPlaylists!('并发', 30, 30);
    const p4 = client.searchPlaylists!('并发B', 30);
    await tick();
    expect(seen).toHaveLength(3); // 不同键：各自一发
    gates.splice(0).forEach((g) => g());
    await Promise.all([p3, p4]);
  });
});

describe('neteaseDirect.searchArtists 硬化（#415：迁 cloudsearch/pc type=100）', () => {
  it('请求形态：POST cloudsearch/pc form type=100；字段映射与 https 头像修复保持', async () => {
    const seen = mockTransport([
      {
        ...cloudsearch,
        respond: (req) => {
          const q = form(req);
          expect(q.get('type')).toBe('100');
          expect(q.get('s')).toBe('周杰伦');
          return json({
            code: 200,
            result: {
              artists: [{ id: 6452, name: '周杰伦', picUrl: 'http://p1.music.126.net/a.jpg', alias: ['Jay'], albumSize: 30, musicSize: 300 }],
              artistCount: 83,
            },
          });
        },
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const artists = await client.searchArtists!('周杰伦', 30);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(CLOUDSEARCH);
    expect(artists).toHaveLength(1);
    expect(artists[0]).toMatchObject({
      id: '6452',
      name: '周杰伦',
      picUrl: 'https://p1.music.126.net/a.jpg',
      albumSize: 30,
      musicSize: 300,
      sourceType: 'netease',
    });
  });

  it('405/406 不再静默返回 []（抛可区分错误）；code=200 空 artists 才是「真没这个歌手」', async () => {
    let code = 405;
    let message = '操作频繁，请稍候再试';
    mockTransport([{ ...cloudsearch, respond: () => json({ code, message }) }]);
    const client = createNeteaseDirectClient(fakeCache());

    await expect(client.searchArtists!('周杰伦', 30)).rejects.toThrow(/405/);
    code = 406;
    await expect(client.searchArtists!('周杰伦', 30)).rejects.toThrow(/406/);

    // 真无命中：上游 code=200 + 空 artists → 空数组（与失败可区分）
    code = 200;
    message = '';
    const clientOk = createNeteaseDirectClient(fakeCache());
    await expect(clientOk.searchArtists!('周杰伦', 30)).resolves.toEqual([]);
  });
});
