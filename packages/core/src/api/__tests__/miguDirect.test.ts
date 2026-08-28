import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import { setTransport } from '../transport.js';
import { miguDirectClient, decryptXorStream, XOR_KEY } from '../miguDirect.js';

/**
 * 咪咕直连客户端测试（T05 #151）。
 * 接缝：transport.request（T01）——测试注入 mock 传输断言外部行为
 * （搜索映射 / URL 解析与 XOR 解密 / 失败上抛），不真实出网。
 * XOR 解密为纯函数（decryptXorStream），用已知向量独立验证。
 */

const XOR_SEED = 0x03;

/** 用与解密相反的运算构造加密负载（enc = plain - seed + key[i]）。 */
function encryptXor(plainText: string, seed: number): Uint8Array {
  const enc = Array.from(plainText, (c, i) =>
    (c.charCodeAt(0) - seed + XOR_KEY.charCodeAt(i % XOR_KEY.length)) & 0xff
  );
  return new Uint8Array([0xab, 0xcd, 0x01, seed, ...enc]);
}

function textResponse(body: string): any {
  return { status: 200, headers: { 'content-type': 'application/json' }, body, finalUrl: 'https://c.musicapp.migu.cn/x' };
}

function miguSong(id = 'M1001', overrides: Partial<Song> = {}): Song {
  return { id, name: '晴天', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 0, sourceType: 'migu', ...overrides };
}

beforeEach(() => {
  setTransport(null);
});

describe('decryptXorStream 换位流解密（纯函数，已知向量）', () => {
  it('带 \xab\xcd\x01 前缀 + seed 的负载可还原明文', () => {
    const plain = '{"code":"000000","data":{"url":"https://audio.migu.cn/1.mp3"}}';
    const raw = encryptXor(plain, XOR_SEED);
    const out = decryptXorStream(raw);
    expect(new TextDecoder().decode(out)).toBe(plain);
  });

  it('无加密前缀时原样返回（非加密响应）', () => {
    const raw = new TextEncoder().encode('{"code":"000000"}');
    expect(decryptXorStream(raw)).toBe(raw);
  });
});

describe('miguDirectClient.searchSongs', () => {
  it('搜索经 transport 出网并映射 Song（lyricUrl → lrc，封面 https）', async () => {
    const transport = vi.fn(async () =>
      textResponse(JSON.stringify({
        code: '000000',
        data: {
          songList: [{
            songId: 'M1001',
            songName: '晴天',
            singer: '周杰伦',
            album: '叶惠美',
            lyricUrl: 'http://music.migu.cn/lyric/1.lrc',
            albumImgs: [{ img: 'http://cover.example.com/1.jpg' }],
          }],
        },
      }))
    );
    setTransport(transport as any);

    const songs = await miguDirectClient.searchSongs('晴天', 1);

    expect(transport).toHaveBeenCalledTimes(1);
    const req = transport.mock.calls[0][0];
    expect(req.url).toContain('c.musicapp.migu.cn/v1.0/content/search_all.do');
    expect(req.url).toContain('text=%E6%99%B4%E5%A4%A9');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: 'M1001',
      name: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      sourceType: 'migu',
    });
    expect(songs[0].lrc).toBe('https://music.migu.cn/lyric/1.lrc');
    expect(songs[0].cover).toBe('https://cover.example.com/1.jpg');
  });

  it('源站异常上抛（供 sourceRouter auto 回退自建 API）', async () => {
    setTransport(async () => { throw new Error('migu 直连失败'); });
    await expect(miguDirectClient.searchSongs('晴天', 1)).rejects.toThrow('migu 直连失败');
  });

  it('业务错误码（非 000000）上抛', async () => {
    setTransport(async () => textResponse(JSON.stringify({ code: '300001', message: '限流' })) as any);
    await expect(miguDirectClient.searchSongs('晴天', 1)).rejects.toThrow('300001');
  });
});

describe('miguDirectClient.resolvePlayableUrl', () => {
  it('listen-url 加密响应经 XOR 解密取 data.url', async () => {
    const plain = JSON.stringify({ code: '000000', data: { url: 'http://audio.migu.cn/1.mp3' } });
    const transport = vi.fn(async () => ({
      status: 200,
      headers: { signature: '1' },
      body: encryptXor(plain, XOR_SEED).buffer,
      finalUrl: 'https://c.musicapp.migu.cn/strategy/listen-url/h5/v2.4',
    }));
    setTransport(transport as any);

    const url = await miguDirectClient.resolvePlayableUrl!(miguSong());

    expect(transport).toHaveBeenCalledTimes(1);
    const req = transport.mock.calls[0][0];
    expect(req.url).toContain('c.musicapp.migu.cn/strategy/listen-url/h5/v2.4');
    expect(req.responseType).toBe('arraybuffer');
    expect(url).toBe('https://audio.migu.cn/1.mp3');
  });

  it('非加密响应直接解析 JSON 取 url', async () => {
    setTransport(async () =>
      textResponse(JSON.stringify({ code: '000000', data: { url: 'http://audio.migu.cn/2.mp3' } })) as any
    );
    const url = await miguDirectClient.resolvePlayableUrl!(miguSong('M1002'));
    expect(url).toBe('https://audio.migu.cn/2.mp3');
  });

  it('无 url（版权受限）返回空串', async () => {
    setTransport(async () => textResponse(JSON.stringify({ code: '000000', data: { url: '' } })) as any);
    const url = await miguDirectClient.resolvePlayableUrl!(miguSong('M1003'));
    expect(url).toBe('');
  });

  it('失败上抛（供 auto 回退）', async () => {
    setTransport(async () => { throw new Error('migu listen 失败'); });
    await expect(miguDirectClient.resolvePlayableUrl!(miguSong())).rejects.toThrow('migu listen 失败');
  });
});
