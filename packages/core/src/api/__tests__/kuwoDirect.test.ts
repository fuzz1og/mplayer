import { describe, it, expect, beforeEach, vi } from 'vitest';
import pako from 'pako';
import iconv from 'iconv-lite';
import type { Song } from '../../types/index.js';
import { setTransport } from '../transport.js';
import {
  kuwoDirectClient,
  kuwoDesEncrypt,
  decryptQuery,
  encryptQuery,
  decodeKuwoLyricBody,
} from '../kuwoDirect.js';

/**
 * 酷我直连客户端测试（T08 #154）。
 * 接缝：transport.request（T01）——mock 传输断言外部行为（搜索映射 / mobi.s URL 解析 /
 * 歌词响应解码 / 失败回退）。DES 为自实现位运算移植，用加密↔解密回环 + 结构断言验证；
 * 歌词管线（zlib + XOR + gb18030）用构建-解码回环验证，gb18030 由 iconv-lite 独立解码。
 */

function textResponse(body: string): any {
  return { status: 200, headers: { 'content-type': 'text/plain' }, body, finalUrl: 'http://mobi.kuwo.cn/mobi.s' };
}

function kuwoSong(id = 'MUSIC_123456', overrides: Partial<Song> = {}): Song {
  return { id, name: '晴天', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 0, sourceType: 'kuwo', ...overrides };
}

beforeEach(() => {
  setTransport(null);
  vi.clearAllMocks();
});

describe('自实现 DES（musicdl kuwoutils 移植）', () => {
  it('加密→解密回环（内容还原；非标准填充长度不做假设）', () => {
    const plain = new TextEncoder().encode('user=0&corp=kuwo&rid=123456');
    const enc = kuwoDesEncrypt(plain);
    const dec = decryptQuery(enc);
    expect(dec.length % 8).toBe(0);
    expect(dec.length).toBeGreaterThanOrEqual(plain.length);
    expect(dec.slice(0, plain.length)).toEqual(plain);
  });

  it('encryptQuery 输出 base64 且可回环', () => {
    const query = 'type=convert_url2&format=mp3&rid=1';
    const b64 = encryptQuery(query);
    expect(typeof b64).toBe('string');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dec = decryptQuery(bytes);
    expect(new TextDecoder().decode(dec.slice(0, query.length))).toBe(query);
  });
});

describe('decodeKuwoLyricBody（歌词管线）', () => {
  it('tp=content + zlib + base64 + XOR + gb18030 还原 LRC', () => {
    const lrc = '[00:12.00]晴天 [00:15.00]風の音';
    // 管线：LRC → gb18030 字节（酷我服务端为 gb18030 编码）→ XOR('yeelion') → base64 → zlib
    const lrcBytes = iconv.encode(lrc, 'gb18030');
    const key = new TextEncoder().encode('yeelion');
    const xored = new Uint8Array(lrcBytes.length);
    for (let i = 0; i < lrcBytes.length; i++) xored[i] = lrcBytes[i] ^ key[i % key.length];
    let bin = '';
    for (const b of xored) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    const compressed = pako.deflate(new TextEncoder().encode(b64));
    const buf = new Uint8Array(10 + 4 + compressed.length);
    buf.set(new TextEncoder().encode('tp=content\r\n\r\n'), 0);
    buf.set(compressed, 14);

    expect(decodeKuwoLyricBody(buf)).toBe(lrc);
  });

  it('无 tp=content 前缀返回空串', () => {
    expect(decodeKuwoLyricBody(new TextEncoder().encode('HTTP/1.1 200 OK'))).toBe('');
  });
});

describe('kuwoDirectClient.searchSongs', () => {
  it('搜索经 transport 出网并映射 Song（lrc = newlyric URL）', async () => {
    const transport = vi.fn(async () =>
      textResponse(JSON.stringify({
        abslist: [{
          rid: 123456,
          name: '晴天',
          artist: '周杰伦',
          album: '叶惠美',
          pic: 'http://img.example.com/cover.jpg',
          duration: 269000,
        }],
      }))
    );
    setTransport(transport as any);

    const songs = await kuwoDirectClient.searchSongs('晴天', 1);

    expect(transport).toHaveBeenCalledTimes(1);
    const req = transport.mock.calls[0][0];
    expect(req.url).toContain('www.kuwo.cn/search/searchMusicBykeyWord');
    expect(req.url).toContain('all=%E6%99%B4%E5%A4%A9');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ id: '123456', name: '晴天', artist: '周杰伦', album: '叶惠美', sourceType: 'kuwo' });
    expect(songs[0].cover).toBe('https://img.example.com/cover.jpg');
    expect(songs[0].lrc).toContain('newlyric.kuwo.cn/newlyric.lrc?');
    expect(songs[0].duration).toBe(269);
  });

  it('无 abslist 上抛（供 auto 回退）', async () => {
    setTransport(async () => textResponse(JSON.stringify({ status: true, abslist: undefined })) as any);
    await expect(kuwoDirectClient.searchSongs('晴天', 1)).rejects.toThrow('无 abslist');
  });
});

describe('kuwoDirectClient.resolvePlayableUrl', () => {
  it('mobi.s 响应文本正则提取 http 直链', async () => {
    const transport = vi.fn(async () =>
      textResponse('kw:url=http://audio.kuwo.cn/123.mp3&br=320&fmt=mp3\r\n')
    );
    setTransport(transport as any);

    const url = await kuwoDirectClient.resolvePlayableUrl!(kuwoSong());

    const req = transport.mock.calls[0][0];
    expect(req.url).toContain('mobi.kuwo.cn/mobi.s?f=kuwo&q=');
    expect(url).toBe('http://audio.kuwo.cn/123.mp3');
  });

  it('无可用直链返回空串', async () => {
    setTransport(async () => textResponse('kw:msg=无版权') as any);
    const url = await kuwoDirectClient.resolvePlayableUrl!(kuwoSong());
    expect(url).toBe('');
  });

  it('失败上抛（供 auto 回退）', async () => {
    setTransport(async () => { throw new Error('kuwo mobi 失败'); });
    await expect(kuwoDirectClient.resolvePlayableUrl!(kuwoSong())).rejects.toThrow('kuwo mobi 失败');
  });
});
