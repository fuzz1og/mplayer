import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { musicApi } from '../musicApi.js';
import { cacheManager } from '../memoryCacheManager.js';
import { planLyricsFetch } from '../../shared/songLyrics.js';
import { sodaDirectClient } from '../sodaDirect.js';
import { setTransport, type TransportRequest } from '../transport.js';
import type { Song } from '../../types/index.js';

/**
 * #629：汽水三条腿（分享页音频 / 分享页歌词 / track_v2 时长）的 id 形状守卫。
 *
 * 换源后 `Song.id` 是 `<source>:<站内 id>`（core `shared/sourceSwap.ts`），而汽水端点
 * 只认站内裸 ID：**实测（#629 取证）带前缀不报错**——分享页返 HTTP 200 +
 * `status_code:1000004` 的软错误空壳（`url:""`、无 `lyrics.sentences`），于是歌词、
 * 可播地址、时长探测**同时静默失效**。与 #623 同形（网易返 `code=400`，至少像个错误）。
 *
 * 接缝 = **出网请求 URL 本身**：分享页与 musicApi 的 track_v2 兜底直用 axios（不经
 * transport 接缝），`sodaDirectClient.resolveUrlInfo` 的 track_v2 走 transport，
 * 两条边界各自 mock，都不真实出网。假端点按生产行为响应：只有裸 ID 才给满壳。
 */

/** 生产真实 track_id（#629 取证用同一首：晴天 / 董） */
const BARE_ID = '7677974949729945634';

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  request: vi.fn(),
}));

vi.mock('axios', () => ({ default: { get: axiosMock.get, request: axiosMock.request } }));

/** 分享页 HTML：`playable=false` 复刻生产对带前缀 id 的软错误空壳（19KB 壳的关键字段）。 */
function sharePageHtml(trackId: string, playable: boolean): string {
  const audio = playable
    ? {
        url: encodeURIComponent('https://v5-luna.douyinvod.com/a.mp4'),
        trackName: '晴天',
        artistName: '董',
        coverURL: '',
        lyrics: { sentences: [{ startMs: 0, endMs: 3000, text: '第一句' }] },
        trackInfo: { duration: 155304 },
      }
    : { url: '', trackName: '-', artistName: '', coverURL: '', trackInfo: {}, hasCopyright: false };
  return `window._ROUTER_DATA = ${JSON.stringify({
    loaderData: { track_page: { audioWithLyricsOption: audio } },
    trackId,
  })};`;
}

/**
 * 出网假端点（只按「站内裸 ID」给满壳，其余一律空壳 —— 复刻 #629 实测）：
 * - `music.douyin.com/qishui/share/track`：分享页（歌词 + 音频直链 + trackInfo.duration）
 * - `api.qishui.com/luna/pc/track_v2`：track_v2（getSodaAudioUrl 的降级腿，匿名恒空 body）
 */
function stubSodaEndpoints(opts: { sharePageOffline?: boolean } = {}) {
  axiosMock.get.mockImplementation(async (url: string) => {
    const u = new URL(url);
    if (u.hostname === 'music.douyin.com') {
      if (opts.sharePageOffline) return { data: '<html>no _ROUTER_DATA</html>' };
      const trackId = u.searchParams.get('track_id') ?? '';
      return { data: sharePageHtml(trackId, trackId === BARE_ID) };
    }
    if (u.hostname === 'api.qishui.com') {
      const trackId = u.searchParams.get('track_id') ?? '';
      if (trackId !== BARE_ID) return { data: {} };
      return {
        data: {
          track: {
            duration: 155304,
            audio_info: {
              play_info_list: [{ size: 1048576, bitrate: 128, main_play_url: 'http://v3-luna.douyinvod.com/fallback.mp4' }],
            },
          },
        },
      };
    }
    throw new Error(`unexpected outbound: ${url}`);
  });
}

/** 收集一次调用真正出网的全部 URL（axios 边界，不是内部函数的调用记录）。 */
async function captureRequests(call: () => Promise<unknown>): Promise<string[]> {
  const before = axiosMock.get.mock.calls.length;
  await call();
  const urls = axiosMock.get.mock.calls.slice(before).map((c) => String(c[0]));
  expect(urls.length, '被测量调用没有出网请求，无法判定请求形状').toBeGreaterThan(0);
  return urls;
}

/** 取其中某个端点的请求 URL（按 host 区分分享页 / track_v2）。 */
const urlFor = (urls: string[], host: 'music.douyin.com' | 'api.qishui.com') =>
  urls.find((u) => new URL(u).hostname === host);

const trackIdOf = (url: string) => new URL(url).searchParams.get('track_id');

/** 读 core 源文件（结构守卫用，风格同 shared/__tests__/sourceRouter.test.ts） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const readSource = (rel: string) => readFileSync(join(testDir, rel), 'utf8');
/** 源码断言必须去注释：注释里常常引用被修掉的旧写法 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 汽水音频直链缓存在 musicApi 模块内（私有 Map，`SODA_URL_CACHE_TTL` = 10 分钟），
 * `cacheManager.clearAll()` 清不掉它。用例之间必须各自从「上一条目已过期」的时钟起步，
 * 否则「这次到底出网了没有」会被上一个用例的缓存吞掉——所以时钟单调推进。
 */
const URL_CACHE_TTL_MS = 10 * 60 * 1000;
/**
 * 用例之间的时钟间隔：留 12 个 TTL 的余量——用例内部还会自己向前推进（探请求形状时要
 * 让缓存过期），间隔不够的话上一条用例写下的条目会**跨用例命中**，把「没出网」误读成
 * 「缓存归一了」，红测假绿（本文件实测踩过）。
 */
const CLOCK_STEP_MS = URL_CACHE_TTL_MS * 12;
let clockOffsetMs = 0;

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  cacheManager.clearAll();
  stubSodaEndpoints();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.parse('2026-10-09T12:00:00Z') + (clockOffsetMs += CLOCK_STEP_MS)));
});

afterEach(() => {
  setTransport(null);
  vi.useRealTimers();
});

describe('汽水歌词腿的 id 形状（#629）', () => {
  it('getSodaLyrics：前缀（soda:<id>）与嵌套（kuwo:soda:<id>）出网 URL 与裸 id 完全一致', async () => {
    const bareUrl = urlFor(await captureRequests(() => musicApi.getSodaLyrics(BARE_ID)), 'music.douyin.com');
    cacheManager.clearAll();
    const prefixedUrl = urlFor(await captureRequests(() => musicApi.getSodaLyrics(`soda:${BARE_ID}`)), 'music.douyin.com');
    cacheManager.clearAll();
    const nestedUrl = urlFor(await captureRequests(() => musicApi.getSodaLyrics(`kuwo:soda:${BARE_ID}`)), 'music.douyin.com');

    // 前缀/嵌套与裸 id 发同一个请求（不是「URL 里含裸 id」这种弱断言）
    expect(prefixedUrl).toBe(bareUrl);
    expect(nestedUrl).toBe(bareUrl);
    expect(trackIdOf(prefixedUrl!)).toBe(BARE_ID);
    expect(trackIdOf(nestedUrl!)).toBe(BARE_ID);
  });

  it('getSodaLyrics：换源产物 id 取到歌词（带前缀在生产端点只返软错误空壳 → 空串）', async () => {
    cacheManager.clearAll();
    await expect(musicApi.getSodaLyrics(`soda:${BARE_ID}`)).resolves.toContain('第一句');
    cacheManager.clearAll();
    await expect(musicApi.getSodaLyrics(`kuwo:soda:${BARE_ID}`)).resolves.toContain('第一句');
  });

  it('getSodaLyrics：裸 id 向后兼容，且裸/前缀两种形状命中同一条缓存', async () => {
    // 裸 id 不受剥前缀影响
    await expect(musicApi.getSodaLyrics(BARE_ID)).resolves.toContain('第一句');
    expect(axiosMock.get).toHaveBeenCalledTimes(1);
    // 缓存键归一：换形状再取一次，命中前一条缓存，不再出网
    await expect(musicApi.getSodaLyrics(`soda:${BARE_ID}`)).resolves.toContain('第一句');
    expect(axiosMock.get).toHaveBeenCalledTimes(1);
  });

  it('取词计划交出原始 song.id（planLyricsFetch 不剥前缀）→ 汽水端点仍只收到裸 ID', async () => {
    // 双端四个宿主调用点都是「plan.id 原样进 getSodaLyrics」：这里按同一条链复现，
    // 证明收口在汽水客户端（宿主侧与 plan 都不动）。
    const plan = planLyricsFetch({ sourceType: 'soda', id: `soda:${BARE_ID}`, lrc: '' });
    expect(plan.kind).toBe('songid');
    if (plan.kind !== 'songid') return;
    expect(plan.id).toBe(`soda:${BARE_ID}`); // 计划给的就是带前缀的原始 id（#629 的入口形状）

    const urls = await captureRequests(() => musicApi.getSodaLyrics(plan.id));
    expect(trackIdOf(urlFor(urls, 'music.douyin.com')!)).toBe(BARE_ID);
  });
});

describe('汽水音频地址腿的 id 形状（#629）', () => {
  it('getSodaAudioUrl：前缀与嵌套的分享页请求 URL 与裸 id 一致，并拿到直链', async () => {
    // 每探一种 id 形状先把时钟推过地址缓存 TTL，保证「这次真的出了网」
    const expireUrlCache = () => vi.advanceTimersByTime(URL_CACHE_TTL_MS + 1);

    const bareUrls = await captureRequests(() => musicApi.getSodaAudioUrl(BARE_ID));
    const bareShare = urlFor(bareUrls, 'music.douyin.com');
    expect(bareShare, '裸 id 应请求分享页').toBeTruthy();
    expireUrlCache();

    const prefixedUrls = await captureRequests(() => musicApi.getSodaAudioUrl(`soda:${BARE_ID}`));
    expect(urlFor(prefixedUrls, 'music.douyin.com'), '前缀形状应发同一个请求').toBe(bareShare);
    expireUrlCache();

    const nestedUrls = await captureRequests(() => musicApi.getSodaAudioUrl(`kuwo:soda:${BARE_ID}`));
    expect(urlFor(nestedUrls, 'music.douyin.com'), '嵌套前缀应发同一个请求').toBe(bareShare);

    // 端到端：换源产物的 id 也取得到可播地址（带前缀时生产返空壳 → 空串，下载/播放双双落空）
    expect(await musicApi.getSodaAudioUrl(`soda:${BARE_ID}`)).toContain('douyinvod.com');
  });

  it('getSodaAudioUrl：地址缓存按源站真实 ID 归一，裸 id 取过后换形状不再出网', async () => {
    await musicApi.getSodaAudioUrl(BARE_ID);
    const requests = axiosMock.get.mock.calls.length;
    const url = await musicApi.getSodaAudioUrl(`soda:${BARE_ID}`);
    expect(url).toContain('douyinvod.com');
    expect(axiosMock.get.mock.calls.length, '前缀形状应与裸 id 命中同一条地址缓存').toBe(requests);
  });

  it('getSodaAudioUrl：分享页失效降级 track_v2 时，兜底请求同样发裸 ID', async () => {
    stubSodaEndpoints({ sharePageOffline: true });
    const urls = await captureRequests(() => musicApi.getSodaAudioUrl(`soda:${BARE_ID}`));
    const trackV2 = urlFor(urls, 'api.qishui.com');
    expect(trackV2, '分享页失效后应降级 track_v2').toBeTruthy();
    expect(trackIdOf(trackV2!)).toBe(BARE_ID);
  });
});

describe('汽水直连客户端的 id 形状（#629，路由入口）', () => {
  /** 换源产物的歌：`Song.id` 是 `soda:<站内 id>`（core shared/sourceSwap 写入的形状） */
  function sodaSong(id: string): Song {
    return { id, name: '晴天', artist: '董', album: '', url: '', cover: '', lrc: '', duration: 155, sourceType: 'soda' };
  }

  /** track_v2 满壳（有登录态时的形状）：只有站内裸 ID 才给 */
  const trackV2Body = () => JSON.stringify({
    track: {
      duration: 155304,
      audio_info: { play_info_list: [{ size: 5242880, bitrate: 320, main_play_url: 'http://v3-luna.douyinvod.com/t.mp4', play_auth: 'TOKEN' }] },
    },
  });

  /** 注入 transport 并记录出网请求（resolveUrlInfo 的 track_v2 腿走这条边界） */
  function stubTrackV2(body: string) {
    const seen: TransportRequest[] = [];
    setTransport(async (req) => {
      seen.push(req);
      return { status: 200, headers: { 'content-type': 'application/json' }, body, finalUrl: req.url };
    });
    return seen;
  }

  it('resolveUrlInfo：track_v2 的 track_id 与裸 id 一致（前缀 / 嵌套都不进请求）', async () => {
    const seen = stubTrackV2(trackV2Body());

    const bare = await sodaDirectClient.resolveUrlInfo!(sodaSong(BARE_ID));
    const prefixed = await sodaDirectClient.resolveUrlInfo!(sodaSong(`soda:${BARE_ID}`));
    const nested = await sodaDirectClient.resolveUrlInfo!(sodaSong(`kuwo:soda:${BARE_ID}`));

    expect(seen.map((r) => new URL(r.url).searchParams.get('track_id'))).toEqual([BARE_ID, BARE_ID, BARE_ID]);
    // 时长探测结果同为满壳的权威时长（带前缀时生产 track_v2 也给不出东西）
    expect(prefixed).toEqual(bare);
    expect(nested).toEqual(bare);
    expect(prefixed?.playTime).toBe(155304);
  });

  it('resolveUrlInfo：track_v2 空 body（匿名常态）降级分享页时，分享页请求同样发裸 ID', async () => {
    stubTrackV2(''); // 实测匿名 track_v2 返 200 空 body，必然落到分享页降级
    const shareUrl = urlFor(await captureRequests(() => sodaDirectClient.resolveUrlInfo!(sodaSong(`soda:${BARE_ID}`))), 'music.douyin.com');
    expect(shareUrl, '应降级请求分享页取权威时长').toBeTruthy();
    expect(trackIdOf(shareUrl!)).toBe(BARE_ID);
  });

  it('resolvePlayableUrl：路由入口的换源产物 id → 分享页请求发裸 ID 并拿到直链', async () => {
    const urls = await captureRequests(() => sodaDirectClient.resolvePlayableUrl(sodaSong(`soda:${BARE_ID}`)));
    expect(trackIdOf(urlFor(urls, 'music.douyin.com')!)).toBe(BARE_ID);
    await expect(sodaDirectClient.resolvePlayableUrl(sodaSong(`kuwo:soda:${BARE_ID}`))).resolves.toContain('douyinvod.com');
  });
});

describe('守卫：汽水侧不再有「原始 song.id 进请求」的写法（#629）', () => {
  // 本文件其余用例证「今天的行为」，这一条证「写法不退化」：汽水腿以后再加端点时，
  // 直接把 song.id 拼进请求/缓存键会被这里拦下（同 #608 的结构守卫风格）。
  it('sodaDirect.ts 里每个 song.id 用法都先过 stripSourceIdPrefix', () => {
    const src = stripComments(readSource('../sodaDirect.ts'));
    const stripped = src.replace(/stripSourceIdPrefix\(\s*String\(\s*song\.id[^)]*\)\s*\)/g, '');
    expect(stripped, 'sodaDirect.ts 出现未剥源前缀的 song.id').not.toMatch(/song\.id/);
  });

  it('musicApi.ts 的汽水请求参数与缓存键不吃未剥前缀的入参', () => {
    const src = stripComments(readSource('../musicApi.ts'));
    // 四个消费点：分享页 URL、track_v2 兜底参数、歌词缓存键、地址缓存键
    for (const [label, pattern] of [
      ['分享页 URL', /track_id=\$\{trackId\}/],
      ['track_v2 参数', /params\.set\('track_id',\s*trackId\)/],
      ['歌词缓存键', /soda_lyric_\$\{trackId\}/],
      ['地址缓存键', /sodaAudioUrlCache\.get\(trackId\)/],
    ] as const) {
      expect(src, `汽水${label}仍把未剥前缀的 trackId 直接用了`).not.toMatch(pattern);
    }
  });
});
