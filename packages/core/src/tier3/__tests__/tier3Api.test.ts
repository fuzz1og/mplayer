import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportRequest, TransportResponse } from '../../api/transport.js';
import type { Song } from '../../types/index.js';
import {
  addTier3SubscriptionFromText,
  clearTier3ProbeCache,
  clearTier3Stats,
  createTier3Resolver,
  explainPlaybackFailure,
  fetchTier3ManifestFromUrl,
  getTier3Stats,
  getTier3State,
  loadTier3State,
  parseTier3Manifest,
  searchTier3Songs,
  setTier3Deps,
  setTier3Enabled,
  setTier3Persister,
  tier3SourceSource,
} from '../tier3Api.js';
import type { Tier3Source } from '../tier3Api.js';
import {
  clearTier3Scheduling,
  getTier3InFlightCount,
  registerDirectClient,
  resolvePlayableSongRouted,
  setSourceMode,
  setSourceModes,
} from '../../shared/sourceRouter.js';
import { setPlaybackTraceSink, type PlaybackTrace } from '../../shared/playbackTrace.js';
import {
  beginInit,
  getSourceScheduleSnapshot,
  isInitialized,
  scoreOf,
} from '../../shared/sourceSchedule.js';

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
      // ADR-0014 决策 6：url-resolver 必须显式声明 source（未声明即拒绝，
      // 因为该腿没有内容级校验，放行等于把 A 源 id 塞给 B 源接口）
      source: 'netease',
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

/** 关掉本用例的单飞初始化窗口（#398）：既有用例验证的是常态串行/预算路径，
 *  窗口形态由「初始化窗口」专测覆盖。注意订阅变更（addTier3SubscriptionFromText）
 *  会清空会话内调度状态并重新开窗，故需在解析前调用。 */
function skipInitWindow(): void {
  beginInit();
}

beforeEach(() => {
  loadTier3State(undefined);
  setTier3Deps({});
  setTier3Persister(null);
  clearTier3Stats();
  // #398：跨歌 K 槽位 + 会话内健康度 + 单飞窗口同为模块级调度状态，用例间必须归零。
  clearTier3Scheduling();
  setPlaybackTraceSink(null);
  setSourceModes({});
  // #361 探测结果按稳定 URL 缓存：跨用例复用同一 cdn URL 时必须清空，
  // 否则前一条用例的探测结果会污染后一条（缓存命中 → 不发 Range）。
  clearTier3ProbeCache();
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
    // 解析响应只有 URL（无 name/artist/时长）→ 只剩 source 声明这一条信任（L5）。
    expect(url).toMatchObject({ url: 'https://cdn.example.com/a.mp3', guard: 'none' });
    // #362：resolver 只记「产出」（resolved）；「交付」（hits）由路由层预算内采纳时 commit。
    expect(getTier3Stats()['demo-url']).toMatchObject({ resolved: 1, hits: 0, misses: 0, skipped: 0, searches: 0 });
  });

  it('域名不在白名单 → 返回空串', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://evil.example.net/a.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBeNull();
  });

  it('非通配白名单不允许子域（安全边界）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://sub.cdn.example.com/a.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBeNull();
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
    expect(await createTier3Resolver()(song())).toBeNull();
    expect(getTier3Stats()['demo-url']).toMatchObject({ resolved: 0, hits: 0, misses: 1, skipped: 0, searches: 0 });
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

    expect(getTier3Stats()['demo-url']).toMatchObject({ resolved: 2, hits: 0, misses: 0, skipped: 0, searches: 0 });
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
    expect(await createTier3Resolver()(song({ sourceType: 'netease' }))).toBeNull();
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
    expect(await createTier3Resolver()(song())).toBeNull();
  });

  it('未声明 source 的 search-then-resolve 仍可用（自带 isExactMatch 内容校验兜住）', async () => {
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
    // ADR-0014 决策 6：search-then-resolve 未声明 source 不再靠 URL 猜源，
    // 而是**允许参与**（它自带 isExactMatch 歌名/歌手校验，错配由内容匹配兜住）。
    // 这里让 search 返回空列表，验证确实发起了请求（而不是被 URL 推断跳过）。
    const request = makeRequestMock({
      'https://api.qqmp3.vip/api/songs.php?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6': () =>
        jsonResponse({ data: [] }, 'https://api.qqmp3.vip/api/songs.php'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song({ sourceType: 'netease' }))).toBeNull();
    // 关键：确实请求了（未被 URL 推断静默跳过）
    expect(request).toHaveBeenCalled();
    expect(request.mock.calls[0][0].url).toContain('songs.php');
  });

  it('上游 HTTP 200 但返回业务错误封套（code/message，如 vkeys 挂掉）→ 未命中', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ code: 110000, message: '音源获取失败' }, 'https://api.example.com/url?id=123&source=netease'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBeNull();
  });

  // #400：封套判定必须让位于「响应里有没有合法直链」。
  // 上游用 HTTP 风格 code 表达成功（`{code:200,message:"成功",url:"…"}`）时，
  // 若先判封套就会把带合法直链的响应整条拒掉。
  const CODE200_MANIFEST = JSON.stringify({
    version: 1,
    sources: [
      {
        id: 'demo-code200',
        kind: 'url-resolver',
        source: 'netease',
        allowedDomains: ['cdn.example.com'],
        resolve: {
          method: 'GET',
          url: 'https://api.example.com/url?id={id}&source={source}',
          responseJsonPath: 'url',
        },
      },
    ],
  });

  it('业务错误封套 + 响应里带合法直链 → 仍交付（#400）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse(
          { code: 200, message: '成功', url: 'https://cdn.example.com/ok.mp3' },
          'https://api.example.com/url?id=123&source=netease',
        ),
      'https://cdn.example.com/ok.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: CODE200_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toMatchObject({ url: 'https://cdn.example.com/ok.mp3' });
  });

  it('业务错误封套 + 取不到直链 → 仍未命中，且保留 warn 归因（#400 不改变失败路径）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const request = makeRequestMock({
        'https://api.example.com/url?id=123&source=netease': () =>
          jsonResponse({ code: 110000, message: '音源获取失败' }, 'https://api.example.com/url?id=123&source=netease'),
      });
      setTier3Deps({ request });
      addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
      setTier3Enabled(true);
      expect(await createTier3Resolver()(song())).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('上游返回错误: code=110000 message=音源获取失败'));
    } finally {
      warn.mockRestore();
    }
  });

  it('业务错误封套 + 直链不在白名单 → 未命中（白名单优先级不因 #400 改变）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse(
          { code: 500, message: '内部错误', url: 'https://evil.example.net/x.mp3' },
          'https://api.example.com/url?id=123&source=netease',
        ),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: CODE200_MANIFEST });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBeNull();
  });

  it('默认关闭时不执行任何请求', async () => {
    const request = vi.fn();
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    expect(await createTier3Resolver()(song())).toBeNull();
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
    // 搜索条目自带歌名+歌手精确匹配 → L4 仅文本护栏。
    expect(url).toMatchObject({ url: 'https://cdn.example.com/b.mp3', guard: 'text-only' });
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
    expect(url).toMatchObject({ url: 'https://cdn.example.com/c.mp3', guard: 'text-only' });
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
    expect(await createTier3Resolver()(song())).toBeNull();
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
    expect(await createTier3Resolver()(song({ name: '恋人', artist: '李荣浩' }))).toBeNull();
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
    expect(url).toMatchObject({ url: 'https://cdn.example.com/full.mp3', guard: 'text-only' });
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

  it('声明值不认识时，搜索候选 sourceType 回退为查询源（不再污染成死值）', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [{
        id: 'typo-search',
        kind: 'search-then-resolve',
        source: 'tidal',
        allowedDomains: ['*.example.com'],
        search: {
          method: 'GET',
          url: 'https://api.example.com/search?keyword={keyword}',
          responseJsonPath: 'data',
          itemsPath: 'data',
          namePath: 'name',
          artistPath: 'artist',
          idPath: 'id',
        },
        resolve: {
          method: 'GET',
          url: 'https://api.example.com/url?id={id}',
          responseJsonPath: 'data.url',
        },
      }],
    });
    const request = makeRequestMock({
      'https://api.example.com/search?keyword=%E6%99%B4%E5%A4%A9': () =>
        jsonResponse(
          { data: [{ id: '1', name: '晴天', artist: '周杰伦' }] },
          'https://api.example.com/search?keyword=x',
        ),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    const songs = await searchTier3Songs('晴天', 1, 'qq');
    expect(songs).toHaveLength(1);
    expect(songs[0].sourceType).toBe('qq');
  });

  it('搜索兜底不按 source 过滤（关键词候选无 id 错配风险），候选标记声明的来源', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'mitu-like',
          name: '酷我系搜索源',
          kind: 'search-then-resolve',
          source: 'kuwo',
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
    // 搜索腿不过滤（ADR-0014 决策 6 的归属约束只针对 url-resolver 解析腿）；
    // 候选 sourceType 取**声明的来源**（经别名归一化），而非查询源。
    const songs = await searchTier3Songs('恋人', 1, 'netease');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ name: '恋人', artist: '李荣浩', sourceType: 'kuwo' });
    // 搜索腿统计此前完全未记，现已补上
    expect(getTier3Stats()['mitu-like'].searches).toBe(1);
  });
});

describe('tier3SourceSource（ADR-0014 决策 6：只认显式声明 + 别名归一化）', () => {
  const mk = (declared?: string): Tier3Source => ({
    id: 't',
    kind: 'url-resolver',
    ...(declared === undefined ? {} : { source: declared }),
    allowedDomains: ['cdn.example.com'],
    resolve: { method: 'GET', url: 'https://api.example.com/url?id={id}', responseJsonPath: 'data.url' },
  });

  it('未声明 source 时不再从 URL 推断（越权猜测已删除）', () => {
    // 旧实现据 host/path 猜源；猜测会「猜不出则放行」，而 url-resolver 无内容校验
    // → 打开跨源错播通道。现在一律 undefined，由 isSourceUsableFor 拒绝。
    // 这些 URL 形态在旧实现里分别被猜成 netease / qq / kuwo。
    const urlLike = (resolveUrl: string): Tier3Source => ({
      id: 't',
      kind: 'url-resolver',
      allowedDomains: ['cdn.example.com'],
      resolve: { method: 'GET', url: resolveUrl, responseJsonPath: 'data.url' },
    });
    expect(tier3SourceSource(urlLike('https://api.126.net/url?id={id}'))).toBeUndefined();
    expect(tier3SourceSource(urlLike('https://api.example.com/qq?id={id}'))).toBeUndefined();
    expect(tier3SourceSource(urlLike('https://api.example.com/api/kw.php?rid={id}'))).toBeUndefined();
  });

  it('显式声明原样生效', () => {
    expect(tier3SourceSource(mk('netease'))).toBe('netease');
    expect(tier3SourceSource(mk('qq'))).toBe('qq');
    expect(tier3SourceSource(mk('kuwo'))).toBe('kuwo');
  });

  it('别名归一化：生态里的异名收敛到规范源键', () => {
    // GD Studio 用 tencent / lx 用 tx，MPlayer 用 qq——不归一化则永不匹配，静默变死源
    expect(tier3SourceSource(mk('tencent'))).toBe('qq');
    expect(tier3SourceSource(mk('tx'))).toBe('qq');
    expect(tier3SourceSource(mk('QQ'))).toBe('qq');
    expect(tier3SourceSource(mk('  qq  '))).toBe('qq');
    expect(tier3SourceSource(mk('163'))).toBe('netease');
    expect(tier3SourceSource(mk('qishui'))).toBe('soda');
    expect(tier3SourceSource(mk('baidu'))).toBe('qianqian');
  });

  it('不认识/非本应用的值（tidal、spotify、拼写错误）视为未声明，不当作死源', () => {
    // 只归一化不校验时，这些值会通过清单校验却永不匹配：解析腿静默变死源，
    // 搜索腿还会把候选 sourceType 污染成该值 → decideRoute 抛「该源暂无直连实现」
    // → 用户看到「可能为 VIP/无版权」的错误提示。local 不是可解析的音乐源，同理。
    expect(tier3SourceSource(mk('tidal'))).toBeUndefined();
    expect(tier3SourceSource(mk('spotify'))).toBeUndefined();
    expect(tier3SourceSource(mk('unknown'))).toBeUndefined();
    expect(tier3SourceSource(mk('local'))).toBeUndefined();
    expect(tier3SourceSource(mk('tencentt'))).toBeUndefined();
  });

  it('声明了不认识 source 的 url-resolver 同样被拒绝（等同未声明，堵跨源错播）', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [{
        id: 'typo-source',
        kind: 'url-resolver',
        source: 'tidal',
        allowedDomains: ['cdn.example.com'],
        resolve: { method: 'GET', url: 'https://api.example.com/url?id={id}', responseJsonPath: 'data.url' },
      }],
    });
    const request = vi.fn();
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(getTier3Stats()['typo-source'].skipped).toBe(1);
  });

  it('未声明的 url-resolver 在解析时被拒绝，不拿错源 id 去解析', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [{
        id: 'no-source',
        kind: 'url-resolver',
        allowedDomains: ['cdn.example.com'],
        resolve: { method: 'GET', url: 'https://api.example.com/url?id={id}', responseJsonPath: 'data.url' },
      }],
    });
    const request = vi.fn();
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBeNull();
    expect(request).not.toHaveBeenCalled();
    // 跳过被计入统计（原实现在 continue 之后才取 stats，被跳过的源连计数都不进）
    expect(getTier3Stats()['no-source'].skipped).toBe(1);
  });
});

describe('ADR-0014 超时阶梯', () => {
  it('单源默认超时 2s（原 15s 远超整链 6s 预算，使预算失去约束力）', async () => {
    const seen: number[] = [];
    const manifest = JSON.stringify({
      version: 1,
      sources: [{
        id: 'no-timeout',
        kind: 'url-resolver',
        source: 'netease',
        allowedDomains: ['cdn.example.com'],
        // 不配 timeoutMs —— 走默认值
        resolve: { method: 'GET', url: 'https://api.example.com/url?id={id}', responseJsonPath: 'data.url' },
      }],
    });
    const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
      if (req.responseType === 'arraybuffer') return audioResponse();
      seen.push(req.timeoutMs ?? -1);
      return jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, req.url);
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    await createTier3Resolver()(song());
    expect(seen[0]).toBe(2_000);
  });

  it('嗅探超时独立（1s），不继承源声明的 timeoutMs', async () => {
    const sniffTimeouts: number[] = [];
    const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
      if (req.responseType === 'arraybuffer') {
        sniffTimeouts.push(req.timeoutMs ?? -1);
        return audioResponse();
      }
      return jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, req.url);
    });
    setTier3Deps({ request });
    // URL_RESOLVER_MANIFEST 声明了 timeoutMs: 3000
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    await createTier3Resolver()(song());
    expect(sniffTimeouts).toEqual([1_000]);
  });

  it('搜索腿补上预算：源挂起时不无限等待，返回已收集结果', async () => {
    vi.useFakeTimers();
    try {
      const manifest = JSON.stringify({
        version: 1,
        sources: [{
          id: 'hangs',
          kind: 'search-then-resolve',
          allowedDomains: ['cdn.example.com'],
          search: {
            method: 'GET',
            url: 'https://api.example.com/search?keyword={keyword}',
            responseJsonPath: 'data',
            itemsPath: 'data.list',
            namePath: 'name',
            idPath: 'id',
          },
          resolve: { method: 'GET', url: 'https://api.example.com/url?id={id}', responseJsonPath: 'data.url' },
        }],
      });
      // 永不落定的源（模拟站点挂起）
      const request = vi.fn(() => new Promise<TransportResponse>(() => {}));
      setTier3Deps({ request });
      addTier3SubscriptionFromText({ text: manifest });
      setTier3Enabled(true);
      const p = searchTier3Songs('晴天', 1, 'qq');
      await vi.advanceTimersByTimeAsync(6_001);
      const songs = await p;
      // 关键：限时返回（不悬挂），结果是空（该源没产出）
      expect(songs).toEqual([]);
      expect(getTier3Stats()['hangs'].searches).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('单源硬墙与整链预算（#365，ADR-0014 决策 2）', () => {
  const hangingManifest = (count: number, timeoutMs?: number): string =>
    JSON.stringify({
      version: 1,
      sources: Array.from({ length: count }, (_, i) => ({
        id: `s${i + 1}`,
        kind: 'url-resolver',
        source: 'netease',
        allowedDomains: ['cdn.example.com'],
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        resolve: { method: 'GET', url: `https://api.example.com/s${i + 1}`, responseJsonPath: 'data.url' },
      })),
    });

  /** 两步源清单（timeoutMs 省略时不写该字段，用于验证「默认值按 kind」）。 */
  const twoStepManifest = (timeoutMs?: number): string =>
    JSON.stringify({
      version: 1,
      sources: [{
        id: 'two-step',
        kind: 'search-then-resolve',
        source: 'qq',
        allowedDomains: ['cdn.example.com'],
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        search: {
          method: 'GET',
          url: 'https://api.example.com/search?keyword={keyword}',
          responseJsonPath: 'data',
          itemsPath: 'data.list',
          namePath: 'name',
          idPath: 'id',
        },
        resolve: { method: 'GET', url: 'https://api.example.com/url?id={id}', responseJsonPath: 'data.url' },
      }],
    });

  it('清单 timeoutMs 只能收紧到 2s 硬墙（3000 → 2000）', async () => {
    const seen: number[] = [];
    const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
      if (req.responseType !== 'arraybuffer') seen.push(req.timeoutMs ?? -1);
      return req.responseType === 'arraybuffer'
        ? audioResponse()
        : jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, req.url);
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST }); // 声明了 timeoutMs: 3000
    setTier3Enabled(true);

    await createTier3Resolver()(song());

    expect(seen[0]).toBe(2_000);
  });

  it('单源硬墙按 kind 分档：search-then-resolve 2.5s（ADR 2026-09-25 决策 7）', async () => {
    const seen: number[] = [];
    const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
      seen.push(req.timeoutMs ?? -1);
      return jsonResponse({ data: { list: [] } }, req.url);
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: twoStepManifest(20_000) });
    setTier3Enabled(true);

    await createTier3Resolver()(song({ id: 'qq:1', sourceType: 'qq' }));

    // 两步源的三段网络串行在同一个单源墙内 → 分档到 2.5s（清单 20s 只能收紧不能放大）
    expect(seen[0]).toBe(2_500);
  });

  it('不写 timeoutMs → 默认吃满该 kind 的硬墙（两步源 2500，ADR 决策 7 补记）', async () => {
    // #394 验收发现：默认值原为扁平 2s，于是「2s 会切掉实测 2047ms 成功路径」这条
    // 分档理由，对任何没显式写 2500 的清单都依然成立——分档等于白设。
    const seen: number[] = [];
    const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
      seen.push(req.timeoutMs ?? -1);
      return jsonResponse({ data: { list: [] } }, req.url);
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: twoStepManifest() });
    setTier3Enabled(true);

    await createTier3Resolver()(song({ id: 'qq:1', sourceType: 'qq' }));

    expect(seen[0]).toBe(2_500);
  });

  it('不写 timeoutMs → 一步源仍是 2s（默认按 kind 取，不是一律 2.5s）', async () => {
    const seen: number[] = [];
    const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
      if (req.responseType !== 'arraybuffer') seen.push(req.timeoutMs ?? -1);
      return req.responseType === 'arraybuffer'
        ? audioResponse()
        : jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, req.url);
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: hangingManifest(1) });
    setTier3Enabled(true);

    await createTier3Resolver()(song());

    expect(seen[0]).toBe(2_000);
  });

  it('清单里更小的 timeoutMs 仍然生效（500 保持 500）', async () => {
    const seen: number[] = [];
    const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
      if (req.responseType !== 'arraybuffer') seen.push(req.timeoutMs ?? -1);
      return req.responseType === 'arraybuffer'
        ? audioResponse()
        : jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, req.url);
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: hangingManifest(1, 500) });
    setTier3Enabled(true);

    await createTier3Resolver()(song());

    expect(seen[0]).toBe(500);
  });

  it('挂起的死源不再吃光整链预算：2s 后换下一个源并命中', async () => {
    const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
      if (req.url.endsWith('/s1')) return new Promise<TransportResponse>(() => {}); // 永不落定
      if (req.responseType === 'arraybuffer') return audioResponse();
      return jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3', song_play_time: 240 } }, req.url);
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: hangingManifest(2, 15_000) });
    setTier3Enabled(true);

    vi.useFakeTimers();
    try {
      const pending = createTier3Resolver()(song());
      await vi.advanceTimersByTimeAsync(2_100);
      const res = await pending;

      expect(res).toMatchObject({ url: 'https://cdn.example.com/a.mp3', guard: 'source-duration' });
      expect(request.mock.calls.map((c) => (c[0] as TransportRequest).url)).toContain('https://api.example.com/s2');
      expect(getTier3Stats()['s1'].lastError).toContain('单源硬墙');
    } finally {
      vi.useRealTimers();
    }
  });

  it('整链预算用尽后不再启动后续源（3 × 2s 后第 4 源不被请求）', async () => {
    const request = vi.fn(() => new Promise<TransportResponse>(() => {})); // 全部挂起
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: hangingManifest(4) });
    setTier3Enabled(true);

    vi.useFakeTimers();
    try {
      skipInitWindow(); // 本用例验证常态串行路径的预算行为
      const pending = createTier3Resolver()(song());
      await vi.advanceTimersByTimeAsync(6_500);
      const res = await pending;

      expect(res).toBeNull();
      const requested = request.mock.calls.map((c) => (c[0] as TransportRequest).url);
      expect(requested).toContain('https://api.example.com/s1');
      expect(requested).toContain('https://api.example.com/s2');
      expect(requested).toContain('https://api.example.com/s3');
      expect(requested).not.toContain('https://api.example.com/s4');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('交付口径（#362：命中不再虚报）', () => {
  const setupHit = (): void => {
    const request = makeRequestMock({
      'https://api.example.com/url?id=123&source=netease': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, 'https://api.example.com/url?id=123&source=netease'),
      'https://cdn.example.com/a.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
  };

  it('产出候选只增 resolved；路由层 commit 后才计 hits，discarded 归零', async () => {
    setupHit();
    const res = await createTier3Resolver()(song());
    expect(res).not.toBeNull();
    // 未被调用方采纳 → 计「丢弃」而不是「命中」
    expect(getTier3Stats()['demo-url']).toMatchObject({ resolved: 1, hits: 0, discarded: 1 });
    res?.commit?.();
    expect(getTier3Stats()['demo-url']).toMatchObject({ resolved: 1, hits: 1, discarded: 0 });
    // 同歌去重下多个调用方共享同一条解析：交付只计一次（幂等）
    res?.commit?.();
    expect(getTier3Stats()['demo-url'].hits).toBe(1);
  });
});

describe('播放失败归因（#357）', () => {
  beforeEach(() => setSourceModes({}));

  const manifestOf = (items: unknown[]): string => JSON.stringify({ version: 1, sources: items });

  it('tier3 未开启 → tier3-disabled（可操作：开启）', () => {
    const advice = explainPlaybackFailure(song());
    expect(advice.kind).toBe('tier3-disabled');
    expect(advice.message).toContain('未开启');
  });

  it('已开启但无订阅 → no-subscription', () => {
    setTier3Enabled(true);
    expect(explainPlaybackFailure(song()).kind).toBe('no-subscription');
  });

  it('有适用源但都没命中 → sources-missed（带源数）', () => {
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    const advice = explainPlaybackFailure(song());
    expect(advice.kind).toBe('sources-missed');
    expect(advice.usable).toBe(1);
    expect(advice.message).toContain('1 个订阅源');
  });

  it('源声明的是其他平台 → no-declared-source（可操作：补对应 source 条目）', () => {
    addTier3SubscriptionFromText({
      text: manifestOf([{
        id: 'qq-only', kind: 'url-resolver', source: 'qq', allowedDomains: ['cdn.example.com'],
        resolve: { method: 'GET', url: 'https://api.example.com/qq?id={id}', responseJsonPath: 'data.url' },
      }]),
    });
    setTier3Enabled(true);
    const advice = explainPlaybackFailure(song());
    expect(advice.kind).toBe('no-declared-source');
    expect(advice.message).toContain('source: netease');
  });

  it('有源但 url-resolver 未声明 source 被拒 → all-skipped（带跳过数）', () => {
    addTier3SubscriptionFromText({
      text: manifestOf([{
        id: 'no-source', kind: 'url-resolver', allowedDomains: ['cdn.example.com'],
        resolve: { method: 'GET', url: 'https://api.example.com/x?id={id}', responseJsonPath: 'data.url' },
      }]),
    });
    setTier3Enabled(true);
    const advice = explainPlaybackFailure(song());
    expect(advice.kind).toBe('all-skipped');
    expect(advice.skipped).toBe(1);
    expect(advice.message).toContain('未声明 source');
  });

  it('该源设为仅直连 → direct-only（语义不变，只换可操作文案）', () => {
    addTier3SubscriptionFromText({ text: URL_RESOLVER_MANIFEST });
    setTier3Enabled(true);
    setSourceMode('netease', 'direct');
    expect(explainPlaybackFailure(song()).kind).toBe('direct-only');
  });

  it('tier3 全局未开启优先于仅直连（先给能真正解除的开关，避免误导）', () => {
    setSourceMode('netease', 'direct');
    expect(explainPlaybackFailure(song()).kind).toBe('tier3-disabled');
  });
});

describe('清单能力扩展（#376：E0 护栏字段 / E1 idNormalize / E2 redirect）', () => {
  it('E0：ar_name / singer_name 作为歌手证据参与护栏，不再整条误拒', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'e0',
          kind: 'url-resolver',
          source: 'netease',
          allowedDomains: ['cdn.example.com'],
          resolve: { url: 'https://api.example.com/url?id={id}', responseJsonPath: 'data.url' },
        },
      ],
    });
    const request = makeRequestMock({
      'https://api.example.com/url?id=123': () =>
        jsonResponse(
          { data: { url: 'https://cdn.example.com/a.mp3', name: '晴天', ar_name: '周杰伦' } },
          'https://api.example.com/url?id=123',
        ),
      'https://cdn.example.com/a.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    // 无时长证据 → L4 text-only；歌手字段在扩展前不在探测表里，会被判「歌名匹配、歌手缺失」拒掉。
    const out = await createTier3Resolver()(song());
    expect(out).toMatchObject({ url: 'https://cdn.example.com/a.mp3', guard: 'text-only' });
  });

  it('E1：idNormalize.stripPrefixes 在填充 {id} 前剥掉 MUSIC_ 前缀', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'e1',
          kind: 'url-resolver',
          source: 'kuwo',
          allowedDomains: ['cdn.example.com'],
          idNormalize: { stripPrefixes: ['MUSIC_'] },
          resolve: { url: 'https://api.example.com/url?id={id}', responseJsonPath: 'data.url' },
        },
      ],
    });
    // 路由键就是断言：mock 只登记裸数字 rid，若前缀没被剥掉会抛 unexpected request。
    const request = makeRequestMock({
      'https://api.example.com/url?id=123': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }, 'https://api.example.com/url?id=123'),
      'https://cdn.example.com/a.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    const out = await createTier3Resolver()(song({ id: 'kuwo:MUSIC_123', sourceType: 'kuwo' }));
    expect(out?.url).toBe('https://cdn.example.com/a.mp3');
    expect(request.mock.calls[0][0].url).toBe('https://api.example.com/url?id=123');
  });

  it('E2：responseKind=redirect 取重定向终点，且可省略 responseJsonPath', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'e2',
          kind: 'url-resolver',
          source: 'netease',
          allowedDomains: ['cdn.example.com'],
          resolve: { responseKind: 'redirect', url: 'https://api.example.com/go?id={id}' },
        },
      ],
    });
    const request = makeRequestMock({
      'https://api.example.com/go?id=123': () => ({
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
        body: 'binary-audio-bytes',
        finalUrl: 'https://cdn.example.com/a.mp3',
      }),
      'https://cdn.example.com/a.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    const out = await createTier3Resolver()(song());
    expect(out?.url).toBe('https://cdn.example.com/a.mp3');
  });

  it('E2：redirect 终点不在白名单 / 未发生重定向 → 未命中', async () => {
    const manifest = JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'e2',
          kind: 'url-resolver',
          source: 'netease',
          allowedDomains: ['cdn.example.com'],
          resolve: { responseKind: 'redirect', url: 'https://api.example.com/go?id={id}' },
        },
      ],
    });
    const evil = makeRequestMock({
      'https://api.example.com/go?id=123': () => ({
        status: 200,
        headers: {},
        body: '',
        finalUrl: 'https://evil.example.net/a.mp3',
      }),
    });
    setTier3Deps({ request: evil });
    addTier3SubscriptionFromText({ text: manifest });
    setTier3Enabled(true);
    expect(await createTier3Resolver()(song())).toBeNull();

    // finalUrl 仍等于请求 URL（没发生重定向）→ 不把 API 地址当音频候选。
    const noRedirect = makeRequestMock({
      'https://api.example.com/go?id=123': () => ({
        status: 200,
        headers: {},
        body: '',
        finalUrl: 'https://api.example.com/go?id=123',
      }),
    });
    setTier3Deps({ request: noRedirect });
    expect(await createTier3Resolver()(song())).toBeNull();
  });

  it('E2/E1：非法 responseKind / 空 stripPrefixes 在清单校验阶段被拒', () => {
    const badKind = {
      version: 1,
      sources: [
        {
          id: 'x',
          kind: 'url-resolver',
          allowedDomains: ['x.com'],
          resolve: { url: 'https://x.com/a', responseKind: 'proxy' },
        },
      ],
    };
    expect(() => parseTier3Manifest(JSON.stringify(badKind))).toThrow('responseKind');

    const badNormalize = {
      version: 1,
      sources: [
        {
          id: 'x',
          kind: 'url-resolver',
          allowedDomains: ['x.com'],
          idNormalize: { stripPrefixes: [] },
          resolve: { url: 'https://x.com/a', responseJsonPath: 'url' },
        },
      ],
    };
    expect(() => parseTier3Manifest(JSON.stringify(badNormalize))).toThrow('idNormalize');
  });

  it('E2：json 模式（默认）仍要求 responseJsonPath，行为不变', () => {
    const missing = {
      version: 1,
      sources: [
        { id: 'x', kind: 'url-resolver', allowedDomains: ['x.com'], resolve: { url: 'https://x.com/a' } },
      ],
    };
    expect(() => parseTier3Manifest(JSON.stringify(missing))).toThrow('responseJsonPath');
  });
});

describe('会话内源调度（#398 / ADR 2026-09-25 决策 1–6）', () => {
  const resolver = (id: string, source: string | undefined = 'netease'): Record<string, unknown> => ({
    id,
    kind: 'url-resolver',
    ...(source ? { source } : {}),
    allowedDomains: ['cdn.example.com'],
    resolve: { method: 'GET', url: `https://api.example.com/${id}`, responseJsonPath: 'data.url' },
  });
  const manifestOf = (...items: unknown[]): string => JSON.stringify({ version: 1, sources: items });
  const threeSources = manifestOf(resolver('s1'), resolver('s2'), resolver('s3'));

  /** 直连腿返回空串 → 必经 tier3 兜底（走 sourceRouter 的完整链路）。 */
  const emptyDirect = (): void => {
    registerDirectClient({ key: 'netease', resolvePlayableUrl: vi.fn(async () => '') });
  };
  /** 只取解析腿的上游请求（排除音频嗅探/取证的 cdn 请求）。 */
  const requestedUrls = (request: ReturnType<typeof vi.fn>): string[] =>
    request.mock.calls
      .map((call) => (call[0] as TransportRequest).url)
      .filter((url) => url.startsWith('https://api.example.com/'));
  const hitResponse = (id: string): TransportResponse =>
    jsonResponse({ data: { url: `https://cdn.example.com/${id}.mp3`, song_play_time: 240 } }, `https://api.example.com/${id}`);

  it('冷启动按清单顺序、候选集不变；有样本后按健康度定序（红线：只改顺序）', async () => {
    const traces: PlaybackTrace[] = [];
    setPlaybackTraceSink({ onResolve: (t) => traces.push(t) });
    const request = makeRequestMock({
      'https://api.example.com/s1': () => jsonResponse({ data: {} }, 'https://api.example.com/s1'),
      'https://api.example.com/s2': () => jsonResponse({ data: {} }, 'https://api.example.com/s2'),
      'https://api.example.com/s3': () => hitResponse('s3'),
      'https://cdn.example.com/s3.mp3': audioResponse,
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: threeSources });
    setTier3Enabled(true);
    emptyDirect();

    skipInitWindow();
    const first = await resolvePlayableSongRouted(song());
    expect(first.url).toBe('https://cdn.example.com/s3.mp3');
    // 冷启动零行为变化：清单顺序；命中在第 3 位时前两个照常被请求（绝不跳过候选）
    expect(requestedUrls(request)).toEqual([
      'https://api.example.com/s1',
      'https://api.example.com/s2',
      'https://api.example.com/s3',
    ]);
    expect(traces[0].sourceOrder).toEqual(['s1', 's2', 's3']);
    expect(traces[0].tier3InitWindow).toBeUndefined();
    // 三类分流：前两源完整未命中、第 3 源完整命中
    expect(scoreOf('s1')).toBeCloseTo(0.35, 10);
    expect(scoreOf('s2')).toBeCloseTo(0.35, 10);
    // 命中样本含耗时（首次探测要加载时长解析器，故只断言「高于中性分」这个不变量）
    expect(scoreOf('s3')!).toBeGreaterThan(0.5);

    request.mockClear();
    const second = await resolvePlayableSongRouted(song());
    expect(second.url).toBe('https://cdn.example.com/s3.mp3');
    // 定序生效：好源前置、只打一条上游；候选集仍逐元素齐全（sourceOrder 三个都在）
    expect(requestedUrls(request)).toEqual(['https://api.example.com/s3']);
    expect(traces[1].sourceOrder).toEqual(['s3', 's1', 's2']);
  });

  it('初始化窗口：交错起手 H=600ms、在飞 ≤2，且不引入任何窗口级墙值（决策 4 修订）', async () => {
    vi.useFakeTimers();
    try {
      const seen: { url: string; timeoutMs: number | undefined }[] = [];
      const request = vi.fn((req: TransportRequest): Promise<TransportResponse> => {
        seen.push({ url: req.url, timeoutMs: req.timeoutMs });
        return new Promise<TransportResponse>(() => {});
      });
      setTier3Deps({ request });
      addTier3SubscriptionFromText({ text: threeSources });
      setTier3Enabled(true);
      emptyDirect();

      const pending = resolvePlayableSongRouted(song());
      await vi.advanceTimersByTimeAsync(500);
      expect(seen.map((s) => s.url)).toEqual(['https://api.example.com/s1']);
      await vi.advanceTimersByTimeAsync(200); // 越过 H=600ms → 交错起手第 2 条
      expect(seen.map((s) => s.url)).toEqual(['https://api.example.com/s1', 'https://api.example.com/s2']);
      // 窗口内沿用按 kind 的常态墙（url-resolver 2s）——「窗口墙 4s」已取消
      expect(seen[0].timeoutMs).toBe(2_000);
      expect(seen[1].timeoutMs).toBe(2_000);
      // 窗口内的 2 条在飞计入 K=3：第二条额外借了一个槽位
      expect(getTier3InFlightCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(7_000);
      await pending;
      expect(getTier3InFlightCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('窗口内任一命中即交付、不等在飞的另一条（其观测记「放弃」不进健康度）', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn((req: TransportRequest): Promise<TransportResponse> => {
        if (req.url === 'https://api.example.com/s1') return new Promise<TransportResponse>(() => {});
        if (req.url === 'https://api.example.com/s2') return Promise.resolve(hitResponse('s2'));
        if (req.url === 'https://cdn.example.com/s2.mp3') return Promise.resolve(audioResponse());
        throw new Error(`unexpected request: ${req.url}`);
      });
      setTier3Deps({ request });
      addTier3SubscriptionFromText({ text: manifestOf(resolver('s1'), resolver('s2')) });
      setTier3Enabled(true);
      emptyDirect();

      const pending = resolvePlayableSongRouted(song());
      await vi.advanceTimersByTimeAsync(700); // 越过 H：s2 起手并命中
      const res = await pending;
      expect(res.url).toBe('https://cdn.example.com/s2.mp3');
      // s1 的 2s 墙还没到 → 交付没有等它；观测记「放弃」（samples 不动、不进健康度）
      expect(getSourceScheduleSnapshot()['s1']).toMatchObject({ samples: 0, lastKind: 'abandoned' });
      expect(scoreOf('s1')).toBeNull();
      expect(getSourceScheduleSnapshot()['s2']).toMatchObject({ samples: 1, lastKind: 'complete' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('全局上游在飞上限恒为 3：窗口占 2 条，至少给其他歌留 1 条（决策 5 修订）', async () => {
    vi.useFakeTimers();
    try {
      const seen: string[] = [];
      const request = vi.fn((req: TransportRequest): Promise<TransportResponse> => {
        seen.push(req.url);
        return new Promise<TransportResponse>(() => {});
      });
      setTier3Deps({ request });
      addTier3SubscriptionFromText({ text: threeSources });
      setTier3Enabled(true);
      emptyDirect();

      const first = resolvePlayableSongRouted(song({ id: 'netease:1', name: '歌1' }));
      await vi.advanceTimersByTimeAsync(700); // 窗口起手 2 条在飞
      expect(getTier3InFlightCount()).toBe(2);

      const others = ['netease:2', 'netease:3'].map((id) => resolvePlayableSongRouted(song({ id, name: id })));
      await vi.advanceTimersByTimeAsync(100);
      // 窗口 2 条 + 第二首 1 条 = 3；第三首被 K=3 排队（未发上游）
      expect(seen).toHaveLength(3);
      expect(getTier3InFlightCount()).toBe(3);

      // 放行到底：不泄漏槽位
      await vi.advanceTimersByTimeAsync(20_000);
      await Promise.all([first, ...others]);
      expect(getTier3InFlightCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('截尾（被单源墙切掉）记 censored 并降权 w=0.5', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn((): Promise<TransportResponse> => new Promise<TransportResponse>(() => {}));
      setTier3Deps({ request });
      addTier3SubscriptionFromText({ text: manifestOf(resolver('s1')) });
      setTier3Enabled(true);
      const pending = createTier3Resolver()(song());
      await vi.advanceTimersByTimeAsync(2_100);
      expect(await pending).toBeNull();
      expect(getSourceScheduleSnapshot()['s1']).toMatchObject({ samples: 1, lastKind: 'censored' });
      // 中性分 0.5 → 0.85×0.5 + 0.15×reward(false)=0
      expect(scoreOf('s1')).toBeCloseTo(0.425, 10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('护栏拒绝与 source gate 跳过都不记分（只计数 + trace）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/bad': () =>
        jsonResponse({ data: { url: 'https://cdn.example.com/bad.mp3', song_play_time: 60 } }, 'https://api.example.com/bad'),
      'https://cdn.example.com/bad.mp3': audioResponse,
    });
    setTier3Deps({ request });
    // bad：netease 的 url-resolver，候选时长 60s vs 标称 240s → 护栏拒绝
    // other：声明 qq → 对 netease 的歌被 source gate 跳过（我们没问它）
    addTier3SubscriptionFromText({ text: manifestOf(resolver('bad'), resolver('other', 'qq')) });
    setTier3Enabled(true);

    expect(await createTier3Resolver()(song())).toBeNull();
    expect(getTier3Stats()['bad'].guardRejected).toBe(1);
    expect(getTier3Stats()['other'].skipped).toBe(1);
    expect(getSourceScheduleSnapshot()['bad']).toBeUndefined();
    expect(getSourceScheduleSnapshot()['other']).toBeUndefined();
  });

  it('订阅变更清空会话内健康度与单飞窗口（ADR 决策 2 的重置时机）', async () => {
    const request = makeRequestMock({
      'https://api.example.com/s1': () => jsonResponse({ data: {} }, 'https://api.example.com/s1'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifestOf(resolver('s1')) });
    setTier3Enabled(true);

    expect(await createTier3Resolver()(song())).toBeNull();
    expect(scoreOf('s1')).toBeCloseTo(0.35, 10);
    expect(isInitialized()).toBe(true);

    addTier3SubscriptionFromText({ text: manifestOf(resolver('s1')) });
    expect(getSourceScheduleSnapshot()).toEqual({});
    expect(scoreOf('s1')).toBeNull();
    expect(isInitialized()).toBe(false);
  });

  it('会话内健康度派生进每源统计（getTier3Stats）供设置页展示', async () => {
    const request = makeRequestMock({
      'https://api.example.com/s1': () => jsonResponse({ data: {} }, 'https://api.example.com/s1'),
    });
    setTier3Deps({ request });
    addTier3SubscriptionFromText({ text: manifestOf(resolver('s1')) });
    setTier3Enabled(true);

    await createTier3Resolver()(song());
    expect(getTier3Stats()['s1']).toMatchObject({ misses: 1, healthSamples: 1, demoted: false });
    expect(getTier3Stats()['s1'].healthScore).toBeCloseTo(0.35, 10);
  });
});
