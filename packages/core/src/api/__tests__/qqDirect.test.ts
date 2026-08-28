import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import { setTransport } from '../transport.js';
import {
  qqDirectClient,
  aesCbcPkcs7Encrypt,
  rsaPkcs1v15Encrypt,
  obtainQimei,
  randomGuid,
  resetQqDirectForTests,
} from '../qqDirect.js';
import { decodeLyricBody } from '../musicApi.js';
import { cacheManager } from '../memoryCacheManager.js';

/**
 * QQ 直连客户端测试（T06 #152）。
 * 接缝：transport.request（T01）——mock 传输按 URL 路由（QIMEI 获取 / musicu 网关 /
 * v8 榜单），断言外部行为：QIMEI 请求结构、搜索映射、GetVkey URL 解析、榜单映射、
 * 失败/空串回退。加密纯函数用独立已知向量验证（AES-CBC 向量来自 .NET 独立实现）。
 */

const QIMEI_OK = JSON.stringify({ data: JSON.stringify({ data: { q16: 'q16x', q36: 'q36-abc123' } }) });

function jsonResponse(body: string): any {
  return { status: 200, headers: { 'content-type': 'application/json' }, body, finalUrl: 'https://u.y.qq.com/x' };
}

/** mock 传输：按 URL 分发（QIMEI 获取 + musicu 网关搜索/URL）。 */
function gatewayTransport(searchRes: any, vkeyRes: any) {
  return vi.fn(async (req: any) => {
    if (req.url.includes('tme/trpc/proxy')) return jsonResponse(QIMEI_OK);
    if (req.url.includes('musicu.fcg')) {
      const body = JSON.parse(req.body);
      if (body['music.search.SearchCgiService.DoSearchForQQMusicMobile']) return jsonResponse(JSON.stringify(searchRes));
      if (body['music.vkey.GetVkey.UrlGetVkey']) return jsonResponse(JSON.stringify(vkeyRes));
    }
    return jsonResponse('{}');
  });
}

function qqSong(id = '004Z8Ihr0JIu5s', overrides: Partial<Song> = {}): Song {
  return { id, name: '晴天', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 0, sourceType: 'qq', ...overrides };
}

const SEARCH_OK = {
  'music.search.SearchCgiService.DoSearchForQQMusicMobile': {
    code: 0,
    data: {
      song: {
        list: [{
          mid: '004Z8Ihr0JIu5s',
          title: '晴天',
          singer: [{ name: '周杰伦' }, { name: '杨瑞代' }],
          album: { mid: '003OUlho2HcRHC', name: '叶惠美' },
          interval: 269,
        }],
      },
    },
  },
};

const VKEY_OK = {
  'music.vkey.GetVkey.UrlGetVkey': {
    code: 0,
    data: { midurlinfo: [{ purl: 'M800004Z8Ihr0JIu5s004Z8Ihr0JIu5s.mp3?vkey=abc' }] },
  },
};

beforeEach(() => {
  setTransport(null);
  resetQqDirectForTests();
  cacheManager.clearAll();
  vi.clearAllMocks();
});

describe('加密纯函数（独立已知向量）', () => {
  it('AES-CBC(key=iv) + PKCS7 与 .NET 独立实现一致', () => {
    const ct = aesCbcPkcs7Encrypt('adbcdef123456789', 'helloqq');
    expect(Buffer.from(ct).toString('hex')).toBe('b990fbea3bd1a719cf3278e15730e38d');
  });

  it('RSA-PKCS1v15 输出 128 字节且 PS 随机（两次加密结果不同）', () => {
    const key = new TextEncoder().encode('1234567890abcdef');
    const a = rsaPkcs1v15Encrypt(key);
    const b = rsaPkcs1v15Encrypt(key);
    expect(a).toHaveLength(128);
    expect(b).toHaveLength(128);
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });

  it('randomGuid 为 32 位 hex', () => {
    expect(randomGuid()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('obtainQimei', () => {
  it('请求结构正确（RSA key / AES params / MD5 sign / 特化头）并解析 q36', async () => {
    const transport = vi.fn(async () => jsonResponse(QIMEI_OK));
    setTransport(transport as any);

    const q36 = await obtainQimei();

    expect(q36).toBe('q36-abc123');
    expect(transport).toHaveBeenCalledTimes(1);
    const req = transport.mock.calls[0][0];
    expect(req.url).toBe('https://api.tencentmusic.com/tme/trpc/proxy');
    expect(req.method).toBe('POST');
    expect(req.headers['method']).toBe('GetQimei');
    expect(req.headers['service']).toBe('trpc.tme_datasvr.qimeiproxy.QimeiProxy');
    expect(req.headers['appid']).toBe('qimei_qq_android');
    expect(typeof req.headers['sign']).toBe('string');
    expect(req.headers['sign']).toMatch(/^[0-9a-f]{32}$/);
    const body = JSON.parse(req.body);
    expect(body.app).toBe(0);
    expect(body.os).toBe(1);
    expect(body.qimeiParams.key).toBeTruthy();
    expect(body.qimeiParams.params).toBeTruthy();
    expect(body.qimeiParams.sign).toMatch(/^[0-9a-f]{32}$/);
    expect(body.qimeiParams.extra).toContain('0AND0HD6FE4HY80F');
  });

  it('获取失败回退静态 q36（匿名可用兜底）', async () => {
    setTransport(async () => { throw new Error('qimei 超时'); });
    const q36 = await obtainQimei();
    expect(q36).toBe('6c9d3cd110abca9b16311cee10001e717614');
  });
});

describe('decodeLyricBody（T06 歌词响应归一化）', () => {
  it('QQ fcg JSON + base64 lyric → 解码 LRC', () => {
    const lrc = '[00:12.00]晴天';
    const body = JSON.stringify({ retcode: 0, lyric: Buffer.from(lrc, 'utf-8').toString('base64') });
    expect(decodeLyricBody(body)).toBe(lrc);
  });

  it('纯 LRC 文本原样返回', () => {
    expect(decodeLyricBody('[00:01.00]hello')).toBe('[00:01.00]hello');
  });

  it('非法 JSON / 空 lyric 原样返回', () => {
    expect(decodeLyricBody('{oops')).toBe('{oops');
    expect(decodeLyricBody(JSON.stringify({ retcode: 100 }))).toBe(JSON.stringify({ retcode: 100 }));
  });
});

describe('qqDirectClient.searchSongs', () => {
  it('musicu 网关搜索（comm 带 QIMEI36）并映射 Song', async () => {
    const transport = gatewayTransport(SEARCH_OK, VKEY_OK);
    setTransport(transport as any);

    const songs = await qqDirectClient.searchSongs('晴天', 1);

    // 两次请求：QIMEI + 搜索
    expect(transport.mock.calls).toHaveLength(2);
    const searchReq = transport.mock.calls[1][0];
    const body = JSON.parse(searchReq.body);
    expect(body.comm.QIMEI36).toBe('q36-abc123');
    expect(body['music.search.SearchCgiService.DoSearchForQQMusicMobile'].param.query).toBe('晴天');
    expect(body['music.search.SearchCgiService.DoSearchForQQMusicMobile'].param.page_num).toBe(1);

    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: '004Z8Ihr0JIu5s',
      name: '晴天',
      artist: '周杰伦 / 杨瑞代',
      album: '叶惠美',
      sourceType: 'qq',
      duration: 269,
    });
    expect(songs[0].cover).toContain('y.gtimg.cn/music/photo_new/T002R300x300M000003OUlho2HcRHC.jpg');
    expect(songs[0].lrc).toContain('c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
    expect(songs[0].lrc).toContain('songmid=004Z8Ihr0JIu5s');
  });

  it('业务失败上抛（供 auto 回退）', async () => {
    setTransport(gatewayTransport(
      { 'music.search.SearchCgiService.DoSearchForQQMusicMobile': { code: 10001, data: null } },
      VKEY_OK,
    ) as any);
    await expect(qqDirectClient.searchSongs('晴天', 1)).rejects.toThrow('10001');
  });
});

describe('qqDirectClient.resolvePlayableUrl', () => {
  it('GetVkey purl → CDN 直链', async () => {
    const transport = gatewayTransport(SEARCH_OK, VKEY_OK);
    setTransport(transport as any);

    const url = await qqDirectClient.resolvePlayableUrl!(qqSong());

    const vkeyReq = transport.mock.calls[1][0];
    const body = JSON.parse(vkeyReq.body);
    expect(body['music.vkey.GetVkey.UrlGetVkey'].param.filename[0]).toBe('M800004Z8Ihr0JIu5s004Z8Ihr0JIu5s.mp3');
    expect(body['music.vkey.GetVkey.UrlGetVkey'].param.songmid).toEqual(['004Z8Ihr0JIu5s']);
    expect(url).toBe('https://isure.stream.qqmusic.qq.com/M800004Z8Ihr0JIu5s004Z8Ihr0JIu5s.mp3?vkey=abc');
  });

  it('purl 为空（无版权/VIP）返回空串', async () => {
    setTransport(gatewayTransport(
      SEARCH_OK,
      { 'music.vkey.GetVkey.UrlGetVkey': { code: 0, data: { midurlinfo: [{ purl: '' }] } } },
    ) as any);
    const url = await qqDirectClient.resolvePlayableUrl!(qqSong());
    expect(url).toBe('');
  });

  it('失败上抛（供 auto 回退）', async () => {
    setTransport(gatewayTransport(
      SEARCH_OK,
      { 'music.vkey.GetVkey.UrlGetVkey': { code: 10001, data: null } },
    ) as any);
    await expect(qqDirectClient.resolvePlayableUrl!(qqSong())).rejects.toThrow('10001');
  });
});

describe('qqDirectClient.getToplists（#279 自门面迁入）', () => {
  /** v8 toplist 响应（songlist[].data 包裹形态，mid 缺失时回退数字 id）。 */
  const toplistOk = () => ({
    code: 0,
    songlist: [
      {
        data: {
          mid: '001auUcH4WQs2V',
          id: 496054946,
          name: '恋人',
          singer: [{ name: '李荣浩' }, { name: '另一人' }],
          album: { mid: '004HaG7p4ZkhXA', name: '黑马' },
          interval: 245,
        },
      },
      { data: { id: 900002, name: '缺mid的歌', singer: [{ name: '歌手C' }], album: { mid: '', name: '专辑B' } } },
      { data: null }, // 无 data 的条目跳过
    ],
  });

  /** mock 传输：按 v8 榜单 URL 的 topid/date 路由。 */
  function toplistTransport(respond: (topid: number, date: string) => unknown) {
    return vi.fn(async (req: any) => {
      const url = new URL(req.url);
      const topid = Number(url.searchParams.get('topid'));
      const date = url.searchParams.get('date') || '';
      return { status: 200, headers: {}, body: JSON.stringify(respond(topid, date)), finalUrl: req.url };
    });
  }

  it('v8 toplist 请求形态 + ToplistGroup id=qq:${topid} + songmid 优先映射（#172 回归）', async () => {
    const transport = toplistTransport(() => toplistOk());
    setTransport(transport as any);

    const groups = await qqDirectClient.getToplists!();

    expect(groups.map((g) => g.id)).toEqual(['qq:26', 'qq:27']);
    expect(groups.map((g) => g.name)).toEqual(['热歌榜', '新歌榜']);
    // 两榜各一请求（GET c.y.qq.com v8 toplist，100 首）
    expect(transport.mock.calls).toHaveLength(2);
    const firstUrl = new URL(transport.mock.calls[0][0].url);
    expect(firstUrl.origin + firstUrl.pathname).toBe('https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg');
    expect(firstUrl.searchParams.get('song_num')).toBe('100');
    expect(transport.mock.calls[0][0].headers['Referer']).toBe('https://y.qq.com/');

    const songs = groups[0].songs;
    expect(songs).toHaveLength(2); // 无 data 条目被跳过
    // #172 回归：id 优先 songmid（GetVkey 键），数字 id 496054946 仅在缺 mid 时兜底
    expect(songs[0]).toMatchObject({
      id: '001auUcH4WQs2V',
      name: '恋人',
      artist: '李荣浩/另一人',
      album: '黑马',
      duration: 245,
      sourceType: 'qq',
    });
    expect(songs[0].cover).toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000004HaG7p4ZkhXA_1.jpg');
    expect(songs[1].id).toBe('900002');
    expect(songs[1].duration).toBe(0);
  });

  it('今天数据未更新（code≠0）→ 回退昨天的日期重试', async () => {
    const today = new Date().toISOString().split('T')[0];
    const transport = toplistTransport((_topid, date) => (date === today ? { code: 1 } : toplistOk()));
    setTransport(transport as any);

    const groups = await qqDirectClient.getToplists!();

    // 两榜并发：各先请求今天（code=1）再各重试一次昨日（共 4 次请求）
    const dates = transport.mock.calls.map((c) => new URL(c[0].url).searchParams.get('date'));
    expect(transport.mock.calls).toHaveLength(4);
    expect(dates.filter((d) => d === today)).toHaveLength(2);
    expect(dates.filter((d) => d !== today)).toHaveLength(2);
    expect(groups[0].songs[0].id).toBe('001auUcH4WQs2V');
  });

  it('请求失败返回空组不抛（与 kugou 榜单失败语义一致）+ 结果写缓存', async () => {
    setTransport((async () => { throw new Error('network down'); }) as any);

    const groups = await qqDirectClient.getToplists!();

    expect(groups.map((g) => g.id)).toEqual(['qq:26', 'qq:27']);
    expect(groups.every((g) => g.songs.length === 0)).toBe(true);
    // 全空不写缓存：下次调用重新请求
    const transport2 = toplistTransport(() => toplistOk());
    setTransport(transport2 as any);
    const again = await qqDirectClient.getToplists!();
    expect(again[0].songs[0].id).toBe('001auUcH4WQs2V');

    // 有歌后写缓存：transport 抛错也命中缓存
    setTransport((async () => { throw new Error('should hit cache'); }) as any);
    const cached = await qqDirectClient.getToplists!();
    expect(cached[0].songs[0].id).toBe('001auUcH4WQs2V');
  });
});
