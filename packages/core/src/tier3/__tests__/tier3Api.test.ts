import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportRequest, TransportResponse } from '../../api/transport.js';
import type { Song } from '../../types/index.js';
import {
  addTier3SubscriptionFromText,
  createTier3Resolver,
  fetchTier3ManifestFromUrl,
  getTier3State,
  loadTier3State,
  parseTier3Manifest,
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
    headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-9/99999' },
    body: AUDIO_BYTES.buffer.slice(AUDIO_BYTES.byteOffset, AUDIO_BYTES.byteOffset + AUDIO_BYTES.byteLength) as ArrayBuffer,
    finalUrl: 'https://cdn.example.com/a.mp3',
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

beforeEach(() => {
  loadTier3State(undefined);
  setTier3Deps({});
  setTier3Persister(null);
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
});
