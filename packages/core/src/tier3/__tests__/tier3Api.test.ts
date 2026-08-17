import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportRequest, TransportResponse } from '../../api/transport.js';
import type { Song } from '../../types/index.js';
import {
  addTier3SubscriptionFromText,
  clearTier3Stats,
  createTier3Resolver,
  fetchTier3ManifestFromUrl,
  getTier3Stats,
  getTier3State,
  loadTier3State,
  parseTier3Manifest,
  searchTier3Songs,
  setTier3Deps,
  setTier3Enabled,
  setTier3Persister,
} from '../tier3Api.js';

/**
 * tier3Api 测试（#144）：
 * - 清单 schema 校验/版本化；
 * - url-resolver 与 search-then-resolve 的声明式执行；
 * - 域名白名单 + 字节嗅探安全边界；
 * - 订阅状态管理（默认关闭、空清单起步）。
 */

const song = (overrides: Partial<Song> = {}): Song => ({
  id: 'netease:123',
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 240,
  sourceType: 'netease',
  ...overrides,
});

const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const HTML_BYTES = new TextEncoder().encode('<html>not audio</html>');

function jsonResponse(body: unknown, url: string): TransportResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    finalUrl: url,
  };
}

function audioResponse(): TransportResponse {
  return {
    status: 206,
    headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-9/99999999' },
    body: AUDIO_BYTES.buffer.slice(AUDIO_BYTES.byteOffset, AUDIO_BYTES.byteOffset + AUDIO_BYTES.byteLength) as ArrayBuffer,
    finalUrl: 'https://cdn.example.com/a.mp3',
  };
}

/** 完整大小 <1MB 的音频（试听片段形态，如酷我 M500 30 秒试听）。 */
function trialAudioResponse(): TransportResponse {
  return {
    status: 206,
    headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-9/524288' },
    body: AUDIO_BYTES.buffer.slice(AUDIO_BYTES.byteOffset, AUDIO_BYTES.byteOffset + AUDIO_BYTES.byteLength) as ArrayBuffer,
    finalUrl: 'https://cdn.example.com/trial.mp3',
  };
}

function htmlResponse(): TransportResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: HTML_BYTES.buffer.slice(HTML_BYTES.byteOffset, HTML_BYTES.byteOffset + HTML_BYTES.byteLength) as ArrayBuffer,
    finalUrl: 'https://cdn.example.com/a.mp3',
  };
}

function makeRequestMock(routes: Record<string, (req: TransportRequest) => TransportResponse>) {
  return vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
    const handler = routes[req.url];
    if (!handler) throw new Error(`unexpected request: ${req.url}`);
    return handler(req);
  });
}

const URL_RESOLVER_MANIFEST = JSON.stringify({
  version: 1,
  sources: [
    {
      id: 'demo-url',
      name: 'Demo URL',
      kind: 'url-resolver',
      allowedDomains: ['cdn.example.com'],
      timeoutMs: 3000,
      headers: { 'X-Demo': '1' },
      resolve: {
        method: 'GET',
        url: 'https://api.example.com/url?id={id}&source={source}',
        responseJsonPath: 'data.url',
      },
    },
  ],
});

const SEARCH_RESOLVER_MANIFEST = JSON.stringify({
  version: 1,
  sources: [
    {
      id: 'demo-search',
      name: 'Demo Search',
      kind: 'search-then-resolve',
      allowedDomains: ['cdn.example.com'],
      timeoutMs: 3000,
      search: {
        method: 'GET',
        url: 'https://api.example.com/search?keyword={keyword}',
        responseJsonPath: 'data',
        itemsPath: 'data.list',
        namePath: 'name',
        artistPath: 'artist',
        urlPath: 'url',
        idPath: 'id',
      },
      resolve: {
        method: 'GET',
        url: 'https://api.example.com/url?id={id}&source={source}',
        responseJsonPath: 'data.url',
      },
    },
  ],
});

/** 无歌手字段的源（如 buguyy 返回 title 而无 artist）——降级边界用例。 */
const NO_ARTIST_MANIFEST = JSON.stringify({
  version: 1,
  sources: [
    {
      id: 'no-artist',
      kind: 'search-then-resolve',
      allowedDomains: ['cdn.example.com'],
      timeoutMs: 3000,
      search: {
        method: 'GET',
        url: 'https://api.example.com/search?keyword={keyword}',
        responseJsonPath: 'data',
        itemsPath: 'data.list',
        namePath: 'title',
        idPath: 'id',
      },
      resolve: {
        method: 'GET',
        url: 'https://api.example.com/url?id={id}',
        responseJsonPath: 'data.url',
      },
    },
  ],
});

beforeEach(() => {
  loadTier3State(undefined);
  setTier3Deps({});
  setTier3Persister(null);
  clearTier3Stats();
});

describe('parseTier3Manifest', () => {
  it('接受合法 v1 清单', () => {
    const manifest = parseTier3Manifest(URL_RESOLVER_MANIFEST);
    expect(manifest.version).toBe(1);
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0].kind).toBe('url-resolver');
  });

  it('拒绝非 JSON / 非 v1 / 缺 sources', () => {
    expect(() => parseTier3Manifest('not json')).toThrow('不是合法 JSON');
    expect(() => parseTier3Manifest(JSON.stringify({ version: 2, sources: [] }))).toThrow('版本不支持');
    expect(() => parseTier3Manifest(JSON.stringify({ version: 1 }))).toThrow('sources 数组');
  });

  it('拒绝重复 source.id 与非法 kind', () => {
    const dup = {
      version: 1,
      sources: [
        { id: 'a', kind: 'url-resolver', allowedDomains: ['x.com'], resolve: { url: 'https://x.com/a', responseJsonPath: 'url' } },
        { id: 'a', kind: 'url-resolver', allowedDomains: ['x.com'], resolve: { url: 'https://x.com/b', responseJsonPath: 'url' } },
      ],
    };
    expect(() => parseTier3Manifest(JSON.stringify(dup))).toThrow('重复');

    const badKind = {
      version: 1,
      sources: [{ id: 'a', kind: 'script', allowedDomains: ['x.com'], resolve: { url: 'https://x.com/a', responseJsonPath: 'url' } }],
    };
    expect(() => parseTier3Manifest(JSON.stringify(badKind))).toThrow('不支持');
  });
});

describe('fetchTier3ManifestFromUrl', () => {
  it('拉取 URL 清单并校验', async () => {
    const request = makeRequestMock({
      'https://subscribe.example.com/manifest.json': () =>
        jsonResponse(JSON.parse(URL_RESOLVER_MANIFEST), 'https://subscribe.example.com/manifest.json'),
    });
    setTier3Deps({ request });
    const manifest = await fetchTier3ManifestFromUrl('https://subscribe.example.com/manifest.json');
    expect(manifest.sources[0].id).toBe('demo-url');
  });

  it('拒绝非 http(s) URL', async () => {
    await expect(fetchTier3ManifestFromUrl('file:///tmp/manifest.json')).rejects.toThrow('http(s)');
  });
});

describe('订阅状态', () => {
  it('默认关闭且空清单', () => {
    expect(getTier3State().enabled).toBe(false);
    expect(getTier3State().subscriptions).toEqual([]);
  });

  it('setTier3Enabled 触发 persister 镜像', () => {
    const persist = vi.fn();
    setTier3Persister(persist);
    setTier3Enabled(true);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('addTier3SubscriptionFromText 更新订阅列表', () => {
    const sub = addTier3SubscriptionFromText({ name: 'Demo', text: URL_RESOLVER_MANIFEST });
    expect(getTier3State().subscriptions).toHaveLength(1);
    expect(sub.name).toBe('Demo');
  });
});

describe('createTier3Resolver（url-resolver）', () => {
  it('直取成功：解析 URL → 域名白名单 → 字节嗅探通过', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
      'https://cdn.example.com/a.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    const url = await createTier3Resolver()(song());
    expect(url).toBe('https://cdn.example.com/a.mp3');
    expect(getTier3Stats()).toEqual({ 'demo-url': { hits: 1, misses: 0 } });
  });

  it('域名不在白名单 → 返回空串', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://evil.example.net/a.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBe('');
  });

  it('非通配白名单不允许子域（安全边界）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://sub.cdn.example.com/a.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBe('');
  });

  it('字节嗅探失败（HTML 冒充音频）→ 返回空串', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
      'https://cdn.example.com/a.mp3': htmlResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBe('');
    expect(getTier3Stats()).toEqual({ 'demo-url': { hits: 0, misses: 1 } });
  });

  it('多次解析按源累计命中/失败', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
      'https://cdn.example.com/a.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);

    await createTier3Resolver()(song());
    await createTier3Resolver()(song());

    expect(getTier3Stats()['demo-url']).toEqual({ hits: 2, misses: 0 });
  });

  it('url-resolver 声明 source 且与当前歌曲 source 不符时跳过，不拿错源 id 去解析', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'qq-only',
          name: 'QQ Only',
          kind: 'url-resolver',
          source: 'qq',
          allowedDomains: ['cdn.example.com'],
          resolve: {
            method: 'GET',
            url: 'https://api.example.com/qq?id={id}',
            responseJsonPath: 'data.url',
          },
        },
      ],
    });
    const request = vi.fn();
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    // 当前是 netease 歌曲，不应把 netease id 塞给 qq-only 的 url-resolver
    expect(await createTier3Resolver()(song({ sourceType: 'netease' }))).toBe('');
    expect(request).not.toHaveBeenCalled();
  });

  it('字节嗅探通过但完整大小 <1MB（疑似试听片段）→ 返回空串，不把片段当完整版', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/trial.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
      'https://cdn.example.com/trial.mp3': trialAudioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBe('');
  });

  it('search-then-resolve 未声明 source 但从 resolve URL 推断（kw.php → kuwo），异源歌曲跳过', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'mitu-like',
          name: '酷我系搜索源',
          kind: 'search-then-resolve',
          allowedDomains: ['*.kuwo.cn'],
          search: {
            method: 'GET',
            url: 'https://api.qqmp3.vip/api/songs.php?keyword={keyword}',
            responseJsonPath: 'data',
            itemsPath: 'data',
            namePath: 'name',
            artistPath: 'artist',
            idPath: 'rid',
          },
          resolve: {
            method: 'GET',
            url: 'https://api.qqmp3.vip/api/kw.php?rid={id}',
            responseJsonPath: 'data.url',
          },
        },
      ],
    });
    const request = vi.fn();
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    // netease 歌曲不应把 id 塞给酷我系 search-then-resolve 源
    expect(await createTier3Resolver()(song({ sourceType: 'netease' }))).toBe('');
    expect(request).not.toHaveBeenCalled();
  });

  it('上游 HTTP 200 但返回业务错误封套（code/message，如 vkeys 挂掉）→ 未命中', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ code: 110000, message: '音源获取失败' }, 'https://api.example.com/url?id=123&source=netease'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBe('');
  });

  it('默认关闭时不执行任何请求', async () => {
    const request = vi.fn();
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    expect(await createTier3Resolver()(song())).toBe('');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('createTier3Resolver（search-then-resolve）', () => {
  it('搜索精确命中并返回直链', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%99%B4%E5%A4%A9%20%E5%91%A8%E6%9D%B0%E4%BC%A6': () =>
        jsonResponse(
          {
            data: {
              list: [
                { id: '999', name: '晴天', artist: '周杰伦', url: 'https://cdn.example.com/b.mp3' },
                { id: '888', name: '晴天', artist: '五月天', url: 'https://cdn.example.com/wrong.mp3' },
              ],
            },
          },
          'https://api.example.com/search?keyword=x',
        ),
      'https://cdn.example.com/b.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: SEARCH_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    const url = await createTier3Resolver()(song());
    expect(url).toBe('https://cdn.example.com/b.mp3');
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET' }));
  });

  it('搜索结果无直链时按 itemId 走 resolve 步骤', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%99%B4%E5%A4%A9%20%E5%91%A8%E6%9D%B0%E4%BC%A6': () =>
        jsonResponse(
          { data: { list: [{ id: '999', name: '晴天', artist: '周杰伦' }] } },
          'https://api.example.com/search?keyword=x',
        ),
      'https://api.example.com/url?id=999&source=netease': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/c.mp3' } }, 'https://api.example.com/url?id=999&source=netease'),
      'https://cdn.example.com/c.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: SEARCH_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    const url = await createTier3Resolver()(song());
    expect(url).toBe('https://cdn.example.com/c.mp3');
  });

  it('搜索无精确匹配 → 返回空串', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%99%B4%E5%A4%A9%20%E5%91%A8%E6%9D%B0%E4%BC%A6': () =>
        jsonResponse(
          { data: { list: [{ id: '999', name: '晴天', artist: '五月天', url: 'https://cdn.example.com/b.mp3' }] } },
          'https://api.example.com/search?keyword=x',
        ),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: SEARCH_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBe('');
  });

  it('候选无歌手字段 + 目标歌手非空 → 拒绝（同名不同歌手不播，如李寒版《恋人》）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%81%8B%E4%BA%BA%20%E6%9D%8E%E8%8D%A3%E6%B5%A9': () =>
        jsonResponse({ data: { list: [{ id: '999', title: '恋人' }] } }, 'https://api.example.com/search?keyword=x'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: NO_ARTIST_MANIFEST });
    setTier3Enabled(true);
    // 目标歌手=李荣浩；候选无歌手字段 → 降级不允许（上游可能返回别的歌手的《恋人》）
    expect(await createTier3Resolver()(song({ name: '恋人', artist: '李荣浩' }))).toBe('');
  });

  it('候选无歌手字段 + 目标歌手为空 → 歌名精确降级接受', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%81%8B%E4%BA%BA': () =>
        jsonResponse({ data: { list: [{ id: '999', title: '恋人' }] } }, 'https://api.example.com/search?keyword=x'),
      'https://api.example.com/url?id=999': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/full.mp3' } }, 'https://api.example.com/url?id=999'),
      'https://cdn.example.com/full.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: NO_ARTIST_MANIFEST });
    setTier3Enabled(true);
    const url = await createTier3Resolver()(song({ name: '恋人', artist: '' }));
    expect(url).toBe('https://cdn.example.com/full.mp3');
  });
});

describe('searchTier3Songs（官方直连搜索失败后的第三方搜索兜底）', () => {
  it('按关键词返回订阅源候选歌曲', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%99%B4%E5%A4%A9': () =>
        jsonResponse(
          {
            data: {
              list: [
                { id: '999', name: '晴天', artist: '周杰伦', url: 'https://cdn.example.com/b.mp3' },
                { id: '888', name: '晴天', artist: '五月天' },
              ],
            },
          },
          'https://api.example.com/search?keyword=x',
        ),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: SEARCH_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    const songs = await searchTier3Songs('晴天', 1, 'qq');
    expect(songs).toHaveLength(2);
    expect(songs[0]).toMatchObject({
      name: '晴天',
      artist: '周杰伦',
      url: 'https://cdn.example.com/b.mp3',
      sourceType: 'qq',
    });
    expect(songs[0].id).toContain('tier3:');
  });

  it('未启用/无订阅时返回空数组', async () => {
    loadTier3State(undefined);
    expect(await searchTier3Songs('晴天', 1, 'qq')).toEqual([]);
  });

  it('第三方搜索兜底过滤掉歌名完全不同的模糊结果', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%99%B4%E5%A4%A9': () =>
        jsonResponse(
          {
            data: {
              list: [
                { id: '999', name: '晴天', artist: '周杰伦' },
                { id: '888', name: '冻结', artist: '林俊杰' },
              ],
            },
          },
          'https://api.example.com/search?keyword=x',
        ),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: SEARCH_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    const songs = await searchTier3Songs('晴天', 1, 'qq');
    expect(songs).toHaveLength(1);
    expect(songs[0].name).toBe('晴天');
  });

  it('拒绝歌名只是查询词子串的完全不同歌曲（搜“恋人”不返回“恋人未满”）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%81%8B%E4%BA%BA': () =>
        jsonResponse(
          {
            data: {
              list: [
                { id: '1', name: '恋人', artist: '李荣浩' },
                { id: '2', name: '恋人未满', artist: 'S.H.E' },
                { id: '3', name: '恋人', artist: '孟庭苇' },
              ],
            },
          },
          'https://api.example.com/search?keyword=x',
        ),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: SEARCH_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    const songs = await searchTier3Songs('恋人', 1, 'qq');
    expect(songs.map((s) => `${s.name}|${s.artist}`)).toEqual(['恋人|李荣浩', '恋人|孟庭苇']);
  });

  it('多词查询的每个词都要命中歌名或歌手（搜“恋人 李荣浩”不返回孟庭苇版）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%81%8B%E4%BA%BA%20%E6%9D%8E%E8%8D%A3%E6%B5%A9': () =>
        jsonResponse(
          {
            data: {
              list: [
                { id: '1', name: '恋人', artist: '李荣浩' },
                { id: '2', name: '恋人', artist: '孟庭苇' },
                { id: '3', name: '恋人', artist: '蒋蕙林' },
              ],
            },
          },
          'https://api.example.com/search?keyword=x',
        ),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: SEARCH_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    const songs = await searchTier3Songs('恋人 李荣浩', 1, 'qq');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ name: '恋人', artist: '李荣浩' });
  });

  it('搜索兜底不按推断 source 过滤（关键词候选无 id 错配风险），候选标记真实来源', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'mitu-like',
          name: '酷我系搜索源',
          kind: 'search-then-resolve',
          allowedDomains: ['*.kuwo.cn'],
          search: {
            method: 'GET',
            url: 'https://api.qqmp3.vip/api/songs.php?keyword={keyword}',
            responseJsonPath: 'data',
            itemsPath: 'data',
            namePath: 'name',
            artistPath: 'artist',
            idPath: 'rid',
          },
          resolve: {
            method: 'GET',
            url: 'https://api.qqmp3.vip/api/kw.php?rid={id}',
            responseJsonPath: 'data.url',
          },
        },
      ],
    });
    const request = makeRequestMock({
      'https://api.qqmp3.vip/api/songs.php?keyword=%E6%81%8B%E4%BA%BA': () =>
        jsonResponse(
          { data: [{ rid: '1', name: '恋人', artist: '李荣浩' }] },
          'https://api.qqmp3.vip/api/songs.php?keyword=x',
        ),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    // netease 查询也能用酷我系源搜候选（搜索无 id 错配），但 sourceType 标记真实来源 kuwo
    const songs = await searchTier3Songs('恋人', 1, 'netease');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ name: '恋人', artist: '李荣浩', sourceType: 'kuwo' });
  });
});
