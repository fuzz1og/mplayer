import { describe, it, expect, afterEach, vi } from 'vitest';
import { setTransport, type TransportRequest } from '../transport.js';
import { neteaseDirectClient } from '../neteaseDirect.js';
import { weapiRequest } from '../neteaseWeapi.js';
import type { Song } from '../../types/index.js';

/**
 * 网易直连客户端测试（T02 #148）。
 * 接缝 = transport（注入 mock 传输驱动全部出网，不真实请求源站）。
 * 覆盖：cloudsearch 搜索映射、weapi URL 解析（含字段映射）、VIP/无版权空 URL、
 *       失败时错误上抛（供 sourceRouter auto 回退自建 API）。
 */

afterEach(() => {
  setTransport(null);
  vi.restoreAllMocks();
});

const UA = /Mozilla\/5\.0/;
const mockSong = (over: Partial<Song> = {}): Song => ({
  id: '1423223445',
  name: '晴天',
  artist: '周杰伦',
  album: 'E.P.',
  duration: 269,
  url: '',
  cover: '',
  lrc: '',
  sourceType: 'netease',
  ...over,
});

/** 捕获并解析 r1 期 cloudsearch 请求，返回构造的响应 */
function captureCloudsearch(respondJson: unknown) {
  let seen: TransportRequest | undefined;
  setTransport(async (req) => {
    seen = req;
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(respondJson), finalUrl: req.url };
  });
  const getSeen = () => seen;
  return getSeen;
}

describe('neteaseDirectClient.search（cloudsearch 直连搜索）', () => {
  it('POST 明文 cloudsearch 表单 s/type/limit/offset，页码从 1 推算 offset', async () => {
    const getSeen = captureCloudsearch({ code: 200, result: { songs: [] } });
    await neteaseDirectClient.search!('晴天', 2);
    const seen = getSeen()!;
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('https://music.163.com/api/cloudsearch/pc');
    expect(seen.headers!['Referer']).toBe('https://music.163.com/');
    expect(UA.test(seen.headers!['User-Agent'])).toBe(true);
    const body = new URLSearchParams(seen.body);
    expect(body.get('type')).toBe('1');
    expect(body.get('s')).toBe('晴天');
    expect(body.get('limit')).toBe('30');
    expect(body.get('offset')).toBe('30'); // (2-1)*30
  });

  it('映射 result.songs → Song（ar/al 数组字段对齐 processNeteaseTrack）', async () => {
    captureCloudsearch({
      code: 200,
      result: {
        songs: [
          {
            id: 1423223445, name: '晴天',
            ar: [{ name: '周杰伦' }, { name: 'TEST' }],
            al: { name: 'E.P.', picUrl: 'http://p1.music.126.net/cover.jpg' },
            dt: 269000,
          },
        ],
      },
    });
    const songs = await neteaseDirectClient.search!('晴天', 1);
    expect(songs).toHaveLength(1);
    const s = songs[0];
    expect(s).toMatchObject({
      id: '1423223445',
      name: '晴天',
      artist: '周杰伦 / TEST',
      album: 'E.P.',
      duration: 269,
      sourceType: 'netease',
    });
    expect(s.cover).toBe('https://p1.music.126.net/cover.jpg'); // http → https
  });

  it('code !== 200 时抛错（风险/风控），供 auto 回退自建 API', async () => {
    captureCloudsearch({ code: 20001, message: 'blocked' });
    await expect(neteaseDirectClient.search!('晴天', 1)).rejects.toThrow();
  });

  it('搜索失败（网络/HTTP 错误）时错误上抛', async () => {
    setTransport(async () => {
      throw new Error('network down');
    });
    await expect(neteaseDirectClient.search!('晴天', 1)).rejects.toThrow('network down');
  });
});

describe('neteaseDirectClient URL 解析（weapi 经 request 接缝出网）', () => {
  /** weapi 请求拦截：return respondJson */
  function mockWeapi(respond: () => Record<string, unknown>) {
    const calls: { path: string; data: Record<string, unknown>; body: string }[] = [];
    setTransport(async (req) => {
      const parsed = new URLSearchParams(req.body);
      calls.push({ path: req.url.replace('https://music.163.com/weapi', ''), data: { params: parsed.get('params')!, encSecKey: parsed.get('encSecKey')! }, body: req.body! });
      return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(respond()), finalUrl: req.url };
    });
    return calls;
  }

  it('resolveUrlInfo 走 /song/enhance/player/url/v1，level=standard、encodeType=mp3', async () => {
    const calls = mockWeapi(() => ({
      code: 200,
      data: [{ id: 1423223445, url: 'http://m701.music.126.net/audio.mp3', br: 128000, size: 4000000, playTime: 269000, fee: 0, payed: 0, code: 200 }],
    }));
    const info = await neteaseDirectClient.resolveUrlInfo!(mockSong());
    // 断言 weapi 出网（接缝上真实握手）+ 字段映射
    expect(calls).toHaveLength(1);
    expect(info).toEqual({
      url: 'https://m701.music.126.net/audio.mp3', // http → https 归一
      br: 128000,
      size: 4000000,
      playTime: 269000,
      fee: 0,
      payed: 0,
    });
  });

  it('resolvePlayableUrl 返回 info.url（非空）', async () => {
    mockWeapi(() => ({
      code: 200,
      data: [{ id: 1423223445, url: 'http://m701.music.126.net/audio.mp3', br: 128000, size: 4000000, playTime: 269000, fee: 0, payed: 0, code: 200 }],
    }));
    const url = await neteaseDirectClient.resolvePlayableUrl!(mockSong());
    expect(url).toBe('https://m701.music.126.net/audio.mp3');
  });

  it('VIP/无版权（接口无 url）→ resolvePlayableUrl 返回空串，不抛错', async () => {
    mockWeapi(() => ({ code: 200, data: [{ id: 1423223445, url: null, br: 0, size: 0, playTime: 0, fee: 8, payed: 0, code: 200 }] }));
    const url = await neteaseDirectClient.resolvePlayableUrl!(mockSong());
    expect(url).toBe('');
  });

  it('URL 解析失败（网络错误）→ 错误上抛（auto 由路由层接手：tier3 兜底后上抛）', async () => {
    setTransport(async () => {
      throw new Error('weapi timeout');
    });
    await expect(neteaseDirectClient.resolvePlayableUrl!(mockSong())).rejects.toThrow('weapi timeout');
  });
});

describe('neteaseDirect 接缝一致性（weapiRequest 复用）', () => {
  it('weapiRequest 经 transport 接缝 JSON 反序列化返回', async () => {
    setTransport(async (req) => {
      expect(req.url).toContain('/weapi/v6/playlist/detail');
      expect(req.method).toBe('POST');
      return { status: 200, headers: {}, body: JSON.stringify({ code: 200, playlist: { id: 1 } }), finalUrl: req.url };
    });
    const data = await weapiRequest<{ code: number; playlist?: { id: number } }>('/v6/playlist/detail', { id: 1 });
    expect(data.code).toBe(200);
    expect(data.playlist?.id).toBe(1);
  });
});
