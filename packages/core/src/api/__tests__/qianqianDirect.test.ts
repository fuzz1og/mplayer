import { describe, it, expect, afterEach } from 'vitest';
import { setTransport } from '../transport.js';
import { qianqianDirectClient } from '../qianqianDirect.js';
import { md5 } from '../../utils/hash.js';
import type { Song } from '../../types/index.js';

/**
 * 千千直连客户端测试（T04 #150）。
 * 接缝 = transport（注入 mock 传输驱动全部出网，不真实请求源站）。
 * 覆盖：search 签名与字段映射、tracklink URL 解析（data.path / trail_audio_info.path）、
 *       无 valid URL → 空串、失败时错误上抛（供 sourceRouter auto 回退自建 API）。
 */

const SECRET = '0b50b02fd0d73a9c4c8c3a781c30845f';

afterEach(() => {
  setTransport(null);
});

/** qianqian 请求拦截：记录 GET query，构造响应 JSON。 */
function mockRequest(options: { url?: string; respond: () => Record<string, unknown> }) {
  const calls: { url: string; query: URLSearchParams; headers: Record<string, string> | undefined }[] = [];
  setTransport(async (req) => {
    const [, q = ''] = req.url.split('?');
    calls.push({ url: req.url, query: new URLSearchParams(q), headers: req.headers });
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.respond()), finalUrl: req.url };
  });
  return calls;
}

const mockSong = (over: Partial<Song> = {}): Song => ({
  id: '65818',
  name: '晴天',
  artist: '周杰伦',
  album: 'FANTASY PLUS',
  duration: 269,
  url: '',
  cover: '',
  lrc: '',
  sourceType: 'qianqian',
  ...over,
});

describe('qianqianDirectClient.searchSongs（标注签名的搜索直连）', () => {
  it('GET music.91q.com/v1/search 携带 word/type/appid + timestamp，头含 referer/from', async () => {
    const calls = mockRequest({ respond: () => ({ data: { typeTrack: [] } }) });
    await qianqianDirectClient.searchSongs!('晴天', 1);
    const c = calls[0];
    expect(c.url).toContain('https://music.91q.com/v1/search');
    expect(c.query.get('word')).toBe('晴天');
    expect(c.query.get('type')).toBe('1');
    expect(c.query.get('appid')).toBe('16073360');
    expect(c.headers!['from']).toBe('web');
    expect(c.headers!['referer']).toBe('https://music.91q.com/player');
    expect(Number(c.query.get('timestamp'))).toBeGreaterThan(0);
  });

  it('sign = md5(sorted_kv + secret)，page 从 1 推算 pageNo/pageSize', async () => {
    const calls = mockRequest({ respond: () => ({ data: { typeTrack: [] } }) });
    const now = Date.now();
    viDate(now);
    try {
      await qianqianDirectClient.searchSongs!('晴天', 3);
    } finally {
      restoreDate();
    }
    const q = calls[0].query;
    // 期望 query 含 word/type/pageNo/pageSize/appid/timestamp/sign
    const base = Object.fromEntries(
      [...q.entries()].filter(([k]) => k !== 'sign' && k !== 'timestamp'),
    ) as Record<string, string>;
    const timestamp = q.get('timestamp')!;
    const kv: Record<string, string> = { ...base, timestamp };
    const signed = [...Object.keys(kv)].sort().map((k) => `${k}=${kv[k]}`).join('&') + SECRET;
    expect(q.get('sign')).toBe(md5(signed));
    expect(q.get('pageNo')).toBe('3');
  });

  it('映射 data.typeTrack[] → Song（TSID/title/artist/albumTitle/pic/lyric）', async () => {
    mockRequest({
      respond: () => ({
        data: {
          typeTrack: [
            {
              TSID: '65818',
              title: '晴天',
              artist: [{ name: '周杰伦' }, { name: '方文山' }],
              albumTitle: 'FANTASY PLUS',
              pic: 'https://p2.music.126.net/cover.jpg',
              lyric: 'https://music.91q.com/lyric/lrc/65818.lrc',
            },
          ],
        },
      }),
    });
    const songs = await qianqianDirectClient.searchSongs!('晴天', 1);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: '65818',
      name: '晴天',
      artist: '周杰伦 / 方文山',
      album: 'FANTASY PLUS',
      sourceType: 'qianqian',
      cover: 'https://p2.music.126.net/cover.jpg',
      lrc: 'https://music.91q.com/lyric/lrc/65818.lrc', // 歌词直连 URL 映射到 Song.lrc
    });
  });

  it('搜索失败（HTTP/网络错误）→ 错误上抛（供 auto 回退自建 API）', async () => {
    setTransport(async () => {
      throw new Error('qianqian down');
    });
    await expect(qianqianDirectClient.searchSongs!('晴天', 1)).rejects.toThrow('qianqian down');
  });
});

describe('qianqianDirectClient URL 解析（tracklink 签名直连）', () => {
  it('resolvePlayableUrl 经 /v1/song/tracklink，取 data.path；头含 from/referer', async () => {
    const calls = mockRequest({ respond: () => ({ data: { path: 'http://music.91q.com/dl/65818.m4a', duration: 269 } }) });
    const url = await qianqianDirectClient.resolvePlayableUrl!(mockSong());
    expect(url).toBe('https://music.91q.com/dl/65818.m4a'); // http → https 归一
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v1/song/tracklink');
    expect(calls[0].query.get('TSID')).toBe('65818');
    expect(calls[0].query.get('appid')).toBe('16073360');
    expect(['320', '128', '64']).toContain(calls[0].query.get('rate'));
    expect(calls[0].query.get('sign')).toBeTruthy();
  });

  it('data.path 缺失时回退 data.trail_audio_info.path', async () => {
    mockRequest({ respond: () => ({ data: { trail_audio_info: { path: 'https://cdns.taihe.com/65818.mp3' } } }) });
    const url = await qianqianDirectClient.resolvePlayableUrl!(mockSong());
    expect(url).toBe('https://cdns.taihe.com/65818.mp3');
  });

  it('无有效 http URL（VIP/无版权）→ 返回空串，不抛错', async () => {
    mockRequest({ respond: () => ({ data: { path: '', trail_audio_info: { path: '' } } }) });
    const url = await qianqianDirectClient.resolvePlayableUrl!(mockSong());
    expect(url).toBe('');
  });

  it('URL 解析失败（网络错误）→ 错误上抛（auto 由路由层接手：tier3 兜底后上抛）', async () => {
    setTransport(async () => {
      throw new Error('tracklink timeout');
    });
    await expect(qianqianDirectClient.resolvePlayableUrl!(mockSong())).rejects.toThrow('tracklink timeout');
  });
});

// —— 测试辅助：mock Date.now 使 sign 断言确定性 ——
const REAL_NOW = Date.now;
function viDate(ts: number) {
  Date.now = () => ts;
}
function restoreDate() {
  Date.now = REAL_NOW;
}
