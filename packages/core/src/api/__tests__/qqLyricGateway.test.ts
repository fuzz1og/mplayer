import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setTransport } from '../transport.js';
import { setApiRequestHandler, musicApi } from '../musicApi.js';
import { fetchLyricViaGateway, resetQqDirectForTests } from '../qqDirect.js';
import { cacheManager } from '../memoryCacheManager.js';

/**
 * QQ 歌词双通道测试：
 * - 主腿：c.y.qq.com fcg GET（强制 Referer 防盗链；桌面 Chromium/Node 栈可带）。
 * - 兜底腿：musicu 网关 GetPlayLyricInfo（无 Referer 校验，与搜索/GetVkey 同通道）。
 * 背景：RN 网络栈发出的 fcg GET 在真机被拒（retcode=-1310 拒绝体），移动端
 * 歌词拿不到——兜底腿用桥接缝（setApiRequestHandler）模拟该拒绝场景。
 */

const LRC = '[ti:恋人]\n[ar:李荣浩]\n[00:01.00]恋人';
const B64 = Buffer.from(LRC, 'utf-8').toString('base64');
const QIMEI_OK = JSON.stringify({ data: JSON.stringify({ data: { q16: 'q16x', q36: 'q36-abc123' } }) });

function fcgUrl(songmid: string): string {
  return `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songmid}&g_tk=5381&loginUin=0&format=json&platform=yqq`;
}

/** transport mock：QIMEI + musicu 网关（歌词模块按 lyricRes 应答）。 */
function gatewayTransport(lyricRes: unknown) {
  return vi.fn(async (req: any) => {
    if (req.url.includes('tme/trpc/proxy')) {
      return { status: 200, headers: {}, body: QIMEI_OK, finalUrl: req.url };
    }
    if (req.url.includes('musicu.fcg')) {
      const body = JSON.parse(req.body);
      if (body['music.musichallSong.PlayLyricInfo.GetPlayLyricInfo']) {
        return { status: 200, headers: {}, body: JSON.stringify(lyricRes), finalUrl: req.url };
      }
    }
    return { status: 200, headers: {}, body: '{}', finalUrl: req.url };
  });
}

function lyricOk(b64: string): unknown {
  return { 'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo': { code: 0, data: { songID: 496054946, lyric: b64 } } };
}

beforeEach(() => {
  setTransport(null);
  setApiRequestHandler(null);
  resetQqDirectForTests();
  cacheManager.clearAll();
  vi.clearAllMocks();
});

afterEach(() => {
  setTransport(null);
  setApiRequestHandler(null);
});

describe('fetchLyricViaGateway（musicu 网关取词）', () => {
  it('base64 lyric → 解码 LRC；请求形状：songMID + 无 songID 键 + qrc/crypt 关', async () => {
    const transport = gatewayTransport(lyricOk(B64));
    setTransport(transport as any);

    const out = await fetchLyricViaGateway('001auUcH4WQs2V');

    expect(out).toBe(LRC);
    const lyricReq = transport.mock.calls.map((c) => c[0]).find((r) => r.url.includes('musicu.fcg'));
    const body = JSON.parse(lyricReq.body);
    expect(body.comm.QIMEI36).toBe('q36-abc123');
    const param = body['music.musichallSong.PlayLyricInfo.GetPlayLyricInfo'].param;
    expect(param.songMID).toBe('001auUcH4WQs2V');
    // songID 键必须整个省略：显式传 0/空串/字符串都会被服务端拒（10006/24001）
    expect('songID' in param).toBe(false);
    expect(param.qrc).toBe(0);
    expect(param.crypt).toBe(0);
  });

  it('模块业务失败上抛（调用方 catch 后按无歌词处理）', async () => {
    setTransport(gatewayTransport({ 'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo': { code: 10006 } }) as any);
    await expect(fetchLyricViaGateway('001auUcH4WQs2V')).rejects.toThrow('10006');
  });

  it('空 lyric（纯音乐）返回空串', async () => {
    setTransport(gatewayTransport(lyricOk('')) as any);
    expect(await fetchLyricViaGateway('001auUcH4WQs2V')).toBe('');
  });

  it('空 songmid 直接空串（不发请求）', async () => {
    const transport = gatewayTransport(lyricOk(B64));
    setTransport(transport as any);
    expect(await fetchLyricViaGateway('')).toBe('');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('getLyrics QQ fcg 双通道', () => {
  it('主腿被拒（RN 场景：-1310 拒绝体）→ 网关兜底拿词', async () => {
    const transport = gatewayTransport(lyricOk(B64));
    setTransport(transport as any);
    // 桥接缝模拟 RN 网络栈：fcg GET 返回 Referer 防盗链拒绝体
    setApiRequestHandler(async (req) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: JSON.stringify({ retcode: -1310, code: -1310, subcode: -1310 }),
      finalUrl: req.url,
    }));

    const out = await musicApi.getLyrics(fcgUrl('001auUcH4WQs2V'));

    expect(out).toBe(LRC);
    // 网关兜底确实发生了（QIMEI + musicu 歌词请求）
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(2);
    // 缓存的是真歌词：二次获取不再出网
    transport.mockClear();
    expect(await musicApi.getLyrics(fcgUrl('001auUcH4WQs2V'))).toBe(LRC);
    expect(transport).not.toHaveBeenCalled();
  });

  it('主腿正常（桌面场景：fcg JSON + base64）→ 不走网关', async () => {
    const transport = gatewayTransport(lyricOk(B64));
    setTransport(transport as any);
    let sawReferer = '';
    setApiRequestHandler(async (req) => {
      sawReferer = req.headers?.['Referer'] || '';
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        text: JSON.stringify({ retcode: 0, lyric: B64 }),
        finalUrl: req.url,
      };
    });

    const out = await musicApi.getLyrics(fcgUrl('002FRBul05dgjC'));

    expect(out).toBe(LRC);
    expect(sawReferer).toContain('y.qq.com'); // 主腿带官方 Referer
    const gatewayLyricCalls = transport.mock.calls.filter((c) => {
      const body = JSON.parse(c[0].body || '{}');
      return !!body['music.musichallSong.PlayLyricInfo.GetPlayLyricInfo'];
    });
    expect(gatewayLyricCalls).toHaveLength(0);
  });

  it('主腿被拒 + 网关也无词 → 返回空串（不缓存拒绝体）', async () => {
    setTransport(gatewayTransport(lyricOk('')) as any);
    setApiRequestHandler(async (req) => ({
      status: 200,
      headers: {},
      text: JSON.stringify({ retcode: -1310 }),
      finalUrl: req.url,
    }));

    const out = await musicApi.getLyrics(fcgUrl('003OUlho2HcRHC'));
    expect(out).toBe('');
  });

  it('主腿 GET 抛错（网络失败）→ 网关兜底拿词', async () => {
    const transport = gatewayTransport(lyricOk(B64));
    setTransport(transport as any);
    setApiRequestHandler(async () => {
      throw new Error('network timeout');
    });

    const out = await musicApi.getLyrics(fcgUrl('004Z8Ihr0JIu5s'));
    expect(out).toBe(LRC);
  });
});
