import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import { setTransport } from '../transport.js';
import { kugouDirectClient, ensureKugouCookie, resolveKugouLyricUrl } from '../kugouDirect.js';

/**
 * 酷狗直连客户端测试（T07 #153）。
 * 接缝：transport.request（T01）——mock 传输断言外部行为（搜索映射 / MD5 兜底 URL /
 * 两步歌词 / 设备 cookie 携带 / 失败回退）。
 */

function jsonResponse(body: string): any {
  return { status: 200, headers: { 'content-type': 'application/json' }, body, finalUrl: 'https://songsearch.kugou.com/x' };
}

function kugouSong(hash = 'abc123', overrides: Partial<Song> = {}): Song {
  return { id: hash, name: '晴天', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 0, sourceType: 'kugou', ...overrides };
}

beforeEach(() => {
  setTransport(null);
  vi.clearAllMocks();
});

describe('kugouDirectClient.search', () => {
  it('搜索映射 Song（hash → id，lrc = 两步歌词 search URL）', async () => {
    const transport = vi.fn(async () =>
      jsonResponse(JSON.stringify({
        data: {
          lists: [{
            hash: 'abc123',
            songname: '晴天',
            singername: '周杰伦',
            album_name: '叶惠美',
            filename: '周杰伦 - 晴天',
            duration: 269,
            cover_url: 'http://img.example.com/{size}.jpg',
          }],
        },
      }))
    );
    setTransport(transport as any);

    const songs = await kugouDirectClient.search('晴天', 1);

    const req = transport.mock.calls[0][0];
    expect(req.url).toContain('songsearch.kugou.com/song_search_v2');
    expect(req.url).toContain('keyword=%E6%99%B4%E5%A4%A9');
    expect(req.headers.Cookie).toContain('KUGOU_API_GUID=');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ id: 'abc123', name: '晴天', artist: '周杰伦', album: '叶惠美', sourceType: 'kugou', duration: 269 });
    expect(songs[0].cover).toBe('https://img.example.com/300.jpg');
    expect(songs[0].lrc).toContain('lyrics.kugou.com/search?hash=abc123');
  });

  it('失败上抛（供 auto 回退）', async () => {
    setTransport(async () => { throw new Error('kugou 搜索失败'); });
    await expect(kugouDirectClient.search('晴天', 1)).rejects.toThrow('kugou 搜索失败');
  });
});

describe('kugouDirectClient.resolvePlayableUrl（MD5 兜底）', () => {
  it('trackercdn i/v2 带 MD5(hash+kgcloudv2) key 并取 data.url', async () => {
    const transport = vi.fn(async () =>
      jsonResponse(JSON.stringify({ status: 1, data: { url: 'http://audio.kugou.com/1.mp3' } }))
    );
    setTransport(transport as any);

    const url = await kugouDirectClient.resolvePlayableUrl!(kugouSong('abc123'));

    const req = transport.mock.calls[0][0];
    expect(req.url).toContain('trackercdn.kugou.com/i/v2/');
    expect(req.url).toContain('hash=abc123');
    expect(url).toBe('https://audio.kugou.com/1.mp3');
  });

  it('取 backupUrl 族兜底字段', async () => {
    setTransport(async () =>
      jsonResponse(JSON.stringify({ status: 1, data: { backupUrl: 'http://backup.kugou.com/2.mp3' } })) as any
    );
    const url = await kugouDirectClient.resolvePlayableUrl!(kugouSong('def456'));
    expect(url).toBe('https://backup.kugou.com/2.mp3');
  });

  it('无 url 返回空串（换元层）', async () => {
    setTransport(async () => jsonResponse(JSON.stringify({ status: 0, data: {} })) as any);
    const url = await kugouDirectClient.resolvePlayableUrl!(kugouSong());
    expect(url).toBe('');
  });
});

describe('ensureKugouCookie（T13 设备 cookie）', () => {
  it('生成酷狗设备 cookie 串且稳定复用（不重复生成）', () => {
    const a = ensureKugouCookie();
    const b = ensureKugouCookie();
    expect(a).toContain('KUGOU_API_GUID=');
    expect(a).toContain('dfid=');
    expect(b).toBe(a);
  });
});

describe('resolveKugouLyricUrl（两步歌词）', () => {
  it('search → download → base64 解码 LRC', async () => {
    const lrc = '[00:12.00]晴天';
    const transport = vi.fn(async (req: any) => {
      if (req.url.includes('lyrics.kugou.com/search')) {
        return jsonResponse(JSON.stringify({ candidates: [{ id: 'c1', accesskey: 'ak1' }] }));
      }
      if (req.url.includes('lyrics.kugou.com/download')) {
        return jsonResponse(JSON.stringify({ content: Buffer.from(lrc, 'utf-8').toString('base64') }));
      }
      return jsonResponse('{}');
    });
    setTransport(transport as any);

    const result = await resolveKugouLyricUrl('http://lyrics.kugou.com/search?hash=abc123&keyword=test');
    expect(result).toBe(lrc);
    expect(transport.mock.calls).toHaveLength(2);
    expect(transport.mock.calls[1][0].url).toContain('id=c1&accesskey=ak1');
  });

  it('无候选返回空串', async () => {
    setTransport(async () => jsonResponse(JSON.stringify({ candidates: [] })) as any);
    const result = await resolveKugouLyricUrl('http://lyrics.kugou.com/search?hash=abc&keyword=x');
    expect(result).toBe('');
  });
});
