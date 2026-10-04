import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setTransport } from '../transport.js';
import { createNeteaseDirectClient } from '../neteaseDirect.js';
import type { ContentCache } from '../../shared/sourceRouter.js';
import type { Song } from '../../types/index.js';

/**
 * #498 方案 C：两条此前**零缓存**的内容腿接上缓存。
 *
 * 修前形态：
 * - `searchSongs` 直接 `return neteaseSearchSongs(...)` —— 同一关键词搜两次 = 两次上游；
 * - `resolvePlayableUrls` 每次专辑/歌单详情 cache miss 都重打一次批量 URL 腿。
 *
 * 这条用例从**出网次数**上钉住（transport 接缝），而不是断言内部有没有调 cache——
 * 「命中零请求」才是 issue 的验收口径。
 */

/** 每次用例一份全新的内存内容缓存：互不串味，也不需要动 core 的单例。 */
function freshCache(): ContentCache {
  const store = new Map<string, unknown>();
  return {
    get: <T,>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    set: <T,>(key: string, data: T) => {
      store.set(key, data);
    },
  };
}

const song = (id: number): Song => ({
  id: String(id),
  name: '歌' + id,
  artist: '歌手',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType: 'netease',
});

interface TransportCall {
  url: string;
}

/** 假传输：按 URL 分流，并把每次调用记下来（出网次数 = 本用例唯一的判据）。 */
function installTransport(opts: { songs?: unknown[]; urls?: { id: number; url: string }[] } = {}) {
  const calls: TransportCall[] = [];
  const transport = vi.fn(async (req: { url: string }) => {
    calls.push({ url: req.url });
    if (req.url.includes(CLOUDSEARCH)) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ code: 200, result: { songs: opts.songs ?? [] } }),
        finalUrl: req.url,
      };
    }
    if (req.url.includes('/song/enhance/player/url/v1')) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ code: 200, data: opts.urls ?? [] }),
        finalUrl: req.url,
      };
    }
    throw new Error('用例没预期的请求: ' + req.url);
  });
  setTransport(transport as never);
  return {
    calls,
    count: (fragment: string) => calls.filter((c) => c.url.includes(fragment)).length,
  };
}

const CLOUDSEARCH = 'cloudsearch';
const URL_LEG = '/song/enhance/player/url/v1';

beforeEach(() => {
  setTransport(null);
  vi.clearAllMocks();
});

describe('#498/C：searchSongs 接缓存', () => {
  it('同一关键词 + 同一页搜两次：第二次 0 请求', async () => {
    const t = installTransport({ songs: [{ id: 1, name: 'A' }] });
    const client = createNeteaseDirectClient(freshCache());

    const first = await client.searchSongs!('周杰伦', 1);
    expect(first.length).toBe(1);
    expect(t.count(CLOUDSEARCH)).toBe(1);

    const second = await client.searchSongs!('周杰伦', 1);
    expect(second).toEqual(first);
    expect(t.count(CLOUDSEARCH)).toBe(1); // ⭐ 第二次没有出网
  });

  it('不同页各自成键：第 2 页仍是自己的请求', async () => {
    const t = installTransport({ songs: [{ id: 1, name: 'A' }] });
    const client = createNeteaseDirectClient(freshCache());

    await client.searchSongs!('周杰伦', 1);
    await client.searchSongs!('周杰伦', 2);

    expect(t.count(CLOUDSEARCH)).toBe(2);
  });

  it('空结果不缓存：真无命中不该被 6h 钉死', async () => {
    const t = installTransport({ songs: [] });
    const client = createNeteaseDirectClient(freshCache());

    await client.searchSongs!('不存在的歌手xyz', 1);
    await client.searchSongs!('不存在的歌手xyz', 1);

    expect(t.count(CLOUDSEARCH)).toBe(2);
  });
});

describe('#498/C：resolvePlayableUrls 接缓存', () => {
  it('同一份歌曲列表补两次：第二次 0 请求，且 URL 仍写回 Song', async () => {
    const t = installTransport({ urls: [{ id: 1, url: 'https://cdn.example.com/1.mp3' }] });
    const client = createNeteaseDirectClient(freshCache());

    const first = [song(1)];
    await client.resolvePlayableUrls!(first);
    expect(first[0].url).toBe('https://cdn.example.com/1.mp3');
    expect(t.count(URL_LEG)).toBe(1);

    const second = [song(1)];
    await client.resolvePlayableUrls!(second);
    expect(second[0].url).toBe('https://cdn.example.com/1.mp3'); // 命中缓存也要补上 URL
    expect(t.count(URL_LEG)).toBe(1); // ⭐ 第二次没有出网
  });

  it('列表顺序不影响命中（按 id 排序成键）', async () => {
    const t = installTransport({ urls: [{ id: 1, url: 'https://cdn.example.com/1.mp3' }] });
    const cache = freshCache();
    const client = createNeteaseDirectClient(cache);

    await client.resolvePlayableUrls!([song(1), song(2)]);
    await client.resolvePlayableUrls!([song(2), song(1)]);

    expect(t.count(URL_LEG)).toBe(1);
  });

  it('列表不同（分页错位）如实重新请求', async () => {
    const t = installTransport({ urls: [{ id: 1, url: 'https://cdn.example.com/1.mp3' }] });
    const client = createNeteaseDirectClient(freshCache());

    await client.resolvePlayableUrls!([song(1)]);
    await client.resolvePlayableUrls!([song(1), song(2)]);

    expect(t.count(URL_LEG)).toBe(2);
  });

  it('空列表：直接返回，不出网', async () => {
    const t = installTransport();
    const client = createNeteaseDirectClient(freshCache());

    await client.resolvePlayableUrls!([]);

    expect(t.count(URL_LEG)).toBe(0);
  });
});
