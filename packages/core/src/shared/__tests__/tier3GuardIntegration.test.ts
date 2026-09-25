import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import type { TransportRequest, TransportResponse } from '../../api/transport.js';
import {
  clearDirectClients,
  registerDirectClient,
  resolvePlayableSongRouted,
  setDirectValidator,
  setSourceModes,
} from '../sourceRouter.js';
import {
  clearTier3ProbeCache,
  clearTier3Stats,
  getTier3Stats,
  loadTier3State,
  setTier3Deps,
  type Tier3Subscription,
} from '../../tier3/tier3Api.js';
import { clearPrefetchCache, setPrefetchedUrl } from '../../api/prefetchCache.js';

// #392 直连腿取证默认会真发 Range：本文件测 tier3 护栏，关闭直连取证以保持零 I/O。
beforeEach(() => { setDirectValidator(null); });

/**
 * tier3 兜底护栏集成测试（#361）。
 *
 * **主缝（唯一集成缝，已有）**：core 播放解析入口 `resolvePlayableSongRouted`——
 * 所有播放路径（渲染层播放 / 下一首预取 / 冷启预热 / 下载 / IPC）的唯一入口，
 * 直连腿与 tier3 腿都经过它。注入方式与既有 sourceRouter 测试一致：
 * 注入直连客户端 + `setTier3Deps` 假传输层（真实 tier3 执行器 + 真实护栏）。
 *
 * 只断言外部行为：是否接受、返回的 `via` / `guard`、是否换下一个源、
 * 是否走既有失败链路；不断言内部调用顺序或私有字段。
 */

const AUDIO_STUB = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // ID3 头
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const song = (duration = 240, overrides: Partial<Song> = {}): Song => ({
  id: '123',
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration,
  sourceType: 'netease',
  ...overrides,
});

function jsonResponse(body: unknown): TransportResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    finalUrl: 'https://api.example.com',
  };
}

/**
 * 音频响应。默认把字节**原样**当 body（Node 下 axios arraybuffer 返回 Buffer，
 * 不是 ArrayBuffer）——这正是回归点：早期实现只判 `instanceof ArrayBuffer`，
 * 非 ArrayBuffer 会被 String()+TextEncoder 文本化损坏，L2 头时长随即变垃圾。
 */
function audioResponse(bytes: Uint8Array, totalBytes: number): TransportResponse {
  return {
    status: 206,
    headers: {
      'content-type': 'audio/mpeg',
      'content-range': `bytes 0-${bytes.length - 1}/${totalBytes}`,
    },
    body: bytes,
    finalUrl: 'https://cdn.example.com',
  };
}

/** Node 形态：body 是 Buffer（`instanceof ArrayBuffer === false`）。 */
function audioResponseBuffer(bytes: Uint8Array, totalBytes: number): TransportResponse {
  return { ...audioResponse(Buffer.from(bytes), totalBytes) };
}

/** 合成 CBR MP3 帧（无 Xing/Info）：头时长不可信、但帧实测码率 ≈128kbps。 */
function cbrMp3Frames(count: number): Uint8Array {
  const frame = 417;
  const out = new Uint8Array(count * frame);
  for (let i = 0; i < count; i++) {
    const o = i * frame;
    out[o] = 0xff;
    out[o + 1] = 0xfb;
    out[o + 2] = 0x90;
  }
  return out;
}

function urlResolver(id: string, source: string | undefined, path = `/resolve-${id}`): Record<string, unknown> {
  return {
    id,
    kind: 'url-resolver',
    ...(source ? { source } : {}),
    allowedDomains: ['cdn.example.com'],
    resolve: { url: `https://api.example.com${path}`, responseJsonPath: 'data.url' },
  };
}

/** 装配订阅 + 假传输层；返回 request mock 供断言「未发起请求」。 */
function setup(
  sources: Record<string, unknown>[],
  routes: Record<string, TransportResponse>,
): ReturnType<typeof vi.fn> {
  const request = vi.fn(async (req: TransportRequest): Promise<TransportResponse> => {
    const res = routes[req.url];
    if (!res) throw new Error(`unexpected request: ${req.url}`);
    return res;
  });
  const subscription: Tier3Subscription = {
    id: 'sub',
    name: 'test',
    kind: 'text',
    source: 'test',
    manifest: { version: 1, sources: sources as never },
    updatedAt: 0,
  };
  loadTier3State({ enabled: true, subscriptions: [subscription] });
  setTier3Deps({ request });
  return request;
}

/** 直连腿：返回空串（无版权/VIP）→ 进入 tier3 兜底。 */
function emptyDirect(source = 'netease'): void {
  registerDirectClient({ key: source as Song['sourceType'], resolvePlayableUrl: vi.fn(async () => '') });
}

beforeEach(() => {
  clearDirectClients();
  clearPrefetchCache();
  clearTier3Stats();
  clearTier3ProbeCache();
  setSourceModes({});
  loadTier3State({ enabled: false, subscriptions: [] });
  setTier3Deps({});
});

describe('护栏分级（L1–L5）走播放解析入口', () => {
  it('L1 源自带时长：一致 → via=tier3 / guard=source-duration', async () => {
    emptyDirect();
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/a.mp3', song_play_time: 240 },
      }),
      'https://cdn.example.com/a.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res).toEqual({
      url: 'https://cdn.example.com/a.mp3',
      nonFull: false,
      via: 'tier3',
      guard: 'source-duration',
    });
    expect(getTier3Stats()['r1'].guards).toEqual({ 'source-duration': 1 });
  });

  it('L1 边界：恰好 2.0s 通过、2.1s 拒绝（换下一个源）', async () => {
    emptyDirect();
    setup([urlResolver('ok', 'netease', '/ok'), urlResolver('edge', 'netease', '/edge')], {
      'https://api.example.com/ok': jsonResponse({
        data: { url: 'https://cdn.example.com/ok.mp3', song_play_time: 242 },
      }),
      'https://api.example.com/edge': jsonResponse({
        data: { url: 'https://cdn.example.com/edge.mp3', song_play_time: 242.1 },
      }),
      'https://cdn.example.com/ok.mp3': audioResponse(AUDIO_STUB, 3_840_000),
      'https://cdn.example.com/edge.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));

    // 第一个源 Δ=2.0 通过 → 直接命中，不会走到第二个
    expect(res.url).toBe('https://cdn.example.com/ok.mp3');
    expect(res.guard).toBe('source-duration');

    // 单独验证 2.1s：只有超差源 → 不过护栏 → 不静默播
    clearTier3Stats();
    setup([urlResolver('edge', 'netease', '/edge')], {
      'https://api.example.com/edge': jsonResponse({
        data: { url: 'https://cdn.example.com/edge.mp3', song_play_time: 242.1 },
      }),
      'https://cdn.example.com/edge.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });
    const rejected = await resolvePlayableSongRouted(song(240));
    expect(rejected).toEqual({ url: '', nonFull: false, via: 'direct', guard: 'none' });
    expect(getTier3Stats()['edge'].guardRejected).toBe(1);
  });

  it('L2 音频头解析：M4A 头时长与标称一致 → guard=audio-header', async () => {
    emptyDirect();
    const m4a = fixture('sample.m4a');
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({ data: { url: 'https://cdn.example.com/a.m4a' } }),
      // 完整大小声明为 5MB（超过试听片段闸）：头字节仍是真实 M4A（moov 全局头）
      'https://cdn.example.com/a.m4a': audioResponse(m4a, 5_000_000),
    });

    const res = await resolvePlayableSongRouted(song(5));

    expect(res.guard).toBe('audio-header');
    expect(res.via).toBe('tier3');
  });

  it('回归：Node Buffer 响应体不被文本化损坏，L2 头时长仍然正确（#364 发现的根因）', async () => {
    emptyDirect();
    const m4a = fixture('sample.m4a');
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({ data: { url: 'https://cdn.example.com/buf.m4a' } }),
      // body 是 Buffer（不是 ArrayBuffer）：旧实现走 String()+TextEncoder → 头字节被毁
      'https://cdn.example.com/buf.m4a': audioResponseBuffer(m4a, 5_000_000),
    });

    const res = await resolvePlayableSongRouted(song(5));

    expect(res.guard).toBe('audio-header');
  });

  it('L3 体积 ÷ 码率：ADTS（无全局头）+ 源自称码率 → guard=size-bitrate（declared 分支）', async () => {
    emptyDirect();
    const adts = fixture('sample.aac');
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/a.aac', br: 128 },
      }),
      'https://cdn.example.com/a.aac': audioResponse(adts, 3_840_000), // 240s × 128kbps
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res.guard).toBe('size-bitrate');
    expect(getTier3Stats()['r1'].sizeBitrateDeclared).toBe(1);
    expect(getTier3Stats()['r1'].sizeBitrateMeasured).toBeUndefined();
  });

  it('L3 帧实测码率分支单独记录（无自称 br）', async () => {
    emptyDirect();
    const mp3 = cbrMp3Frames(150); // 无 Xing/Info → 头时长不可信，帧实测 ≈128kbps
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }),
      'https://cdn.example.com/a.mp3': audioResponse(mp3, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res.guard).toBe('size-bitrate');
    expect(getTier3Stats()['r1'].sizeBitrateMeasured).toBe(1);
  });

  it('L1–L3 三指标：时长一致但歌名/歌手不匹配 → 拒绝（不静默播）', async () => {
    emptyDirect();
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/wrong-song.mp3', song_play_time: 240, name: '晴天', artist: '五月天' },
      }),
      'https://cdn.example.com/wrong-song.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res).toEqual({ url: '', nonFull: false, via: 'direct', guard: 'none' });
    expect(getTier3Stats()['r1'].guardRejected).toBe(1);
  });

  it('L4 仅文本：歌名 + 歌手精确匹配 → guard=text-only', async () => {
    emptyDirect();
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/a.mp3', name: '晴天', artist: '周杰伦' },
      }),
      'https://cdn.example.com/a.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));
    expect(res.guard).toBe('text-only');
  });

  it('L4 文本不匹配（同名不同歌手）→ 拒绝，不静默播', async () => {
    emptyDirect();
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/a.mp3', name: '晴天', artist: '五月天' },
      }),
      'https://cdn.example.com/a.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));
    expect(res).toEqual({ url: '', nonFull: false, via: 'direct', guard: 'none' });
    expect(getTier3Stats()['r1'].guardRejected).toBe(1);
  });

  it('L5 连文本都没有 → 仅 source 声明放行，guard=none（如实标注）', async () => {
    emptyDirect();
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }),
      'https://cdn.example.com/a.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));
    expect(res.guard).toBe('none');
    expect(res.via).toBe('tier3');
  });
});

describe('探测结果按稳定 URL 缓存（成本决策）', () => {
  it('同一 URL 第二次解析复用探测结果，不再发第二次 64KB Range', async () => {
    emptyDirect();
    const request = setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/cached.mp3', song_play_time: 240 },
      }),
      'https://cdn.example.com/cached.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    await resolvePlayableSongRouted(song(240));
    await resolvePlayableSongRouted(song(240));

    const audioFetches = request.mock.calls.filter((c) => (c[0] as TransportRequest).url.includes('cached.mp3'));
    expect(audioFetches).toHaveLength(1);
  });
});

describe('不过护栏的处置', () => {
  it('第一个源不过护栏 → 换下一个候选源，命中第二个', async () => {
    emptyDirect();
    setup([urlResolver('bad', 'netease', '/bad'), urlResolver('good', 'netease', '/good')], {
      'https://api.example.com/bad': jsonResponse({
        data: { url: 'https://cdn.example.com/bad.mp3', song_play_time: 60 },
      }),
      'https://api.example.com/good': jsonResponse({
        data: { url: 'https://cdn.example.com/good.mp3', song_play_time: 240 },
      }),
      'https://cdn.example.com/bad.mp3': audioResponse(AUDIO_STUB, 3_840_000),
      'https://cdn.example.com/good.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res.url).toBe('https://cdn.example.com/good.mp3');
    expect(res.guard).toBe('source-duration');
    expect(getTier3Stats()['bad'].guardRejected).toBe(1);
    expect(getTier3Stats()['good'].hits).toBe(1);
  });

  it('全部源不过护栏 → 走既有失败链路（返回空 URL，绝不取搜索结果第一条）', async () => {
    emptyDirect();
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/wrong.mp3', song_play_time: 60 },
      }),
      'https://cdn.example.com/wrong.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));
    expect(res.url).toBe('');
    expect(res.via).toBe('direct');
  });
});

describe('source gate（url-resolver 不跨源）', () => {
  it('url-resolver 声明 source=qq 而歌是 netease → 跳过且不发请求（日志可见）', async () => {
    emptyDirect();
    const request = setup([urlResolver('r1', 'qq')], {
      'https://api.example.com/resolve-r1': jsonResponse({ data: { url: 'https://cdn.example.com/a.mp3' } }),
      'https://cdn.example.com/a.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res.url).toBe('');
    expect(request).not.toHaveBeenCalled();
    expect(getTier3Stats()['r1'].skipped).toBe(1);
  });

  it('未声明 source 的 url-resolver → 同样被拒（无内容证据，防跨源错配）', async () => {
    emptyDirect();
    const request = setup([urlResolver('r1', undefined)], {});
    const res = await resolvePlayableSongRouted(song(240));
    expect(res.url).toBe('');
    expect(request).not.toHaveBeenCalled();
    expect(getTier3Stats()['r1'].skipped).toBe(1);
  });
});

describe('预取缓存命中路径同样过护栏', () => {
  it('预取命中 nonFull（试听）→ 换 tier3 完整版时护栏生效', async () => {
    emptyDirect();
    setPrefetchedUrl(song(240), 'https://prefetch.example.com/1.mp3', true);
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/full.mp3', song_play_time: 240 },
      }),
      'https://cdn.example.com/full.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res).toEqual({
      url: 'https://cdn.example.com/full.mp3',
      nonFull: false,
      via: 'tier3',
      guard: 'source-duration',
    });
  });

  it('预取命中 nonFull 但 tier3 候选不过护栏 → 退回缓存直连试听（不换成错的东西）', async () => {
    emptyDirect();
    setPrefetchedUrl(song(240), 'https://prefetch.example.com/1.mp3', true);
    setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/wrong.mp3', song_play_time: 30 },
      }),
      'https://cdn.example.com/wrong.mp3': audioResponse(AUDIO_STUB, 3_840_000),
    });

    const res = await resolvePlayableSongRouted(song(240));

    expect(res).toEqual({
      url: 'https://prefetch.example.com/1.mp3',
      nonFull: true,
      via: 'direct',
      guard: 'none',
    });
    expect(getTier3Stats()['r1'].guardRejected).toBe(1);
  });
});

describe('auto / direct 来源开关语义不变', () => {
  it('直连成功 → via=direct / guard=none（护栏不作用于直连腿）', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://direct.example.com/1.mp3'),
    });
    const res = await resolvePlayableSongRouted(song(240));
    expect(res).toEqual({
      url: 'https://direct.example.com/1.mp3',
      nonFull: false,
      via: 'direct',
      guard: 'none',
    });
  });

  it('direct 模式：直连抛错不回退 tier3（既有语义保持不变）', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => {
        throw new Error('直连失败');
      }),
    });
    setSourceModes({ netease: 'direct' });
    const request = setup([urlResolver('r1', 'netease')], {
      'https://api.example.com/resolve-r1': jsonResponse({
        data: { url: 'https://cdn.example.com/a.mp3', song_play_time: 240 },
      }),
    });

    await expect(resolvePlayableSongRouted(song(240))).rejects.toThrow('直连失败');
    expect(request).not.toHaveBeenCalled();
  });
});
