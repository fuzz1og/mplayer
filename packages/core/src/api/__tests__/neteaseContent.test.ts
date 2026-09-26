import { describe, it, expect, afterEach, vi } from 'vitest';
import { setTransport, setTransportRetryOptions, type TransportRequest } from '../transport.js';
import {
  createNeteaseDirectClient,
  getNeteaseLyrics,
} from '../neteaseDirect.js';
import { cacheManager } from '../memoryCacheManager.js';
import { kugouDirectClient } from '../kugouDirect.js';
import type { ContentCache } from '../../shared/sourceRouter.js';
import type { Song } from '../../types/index.js';

/**
 * 内容能力测试（#278）：接缝 = transport（mock 传输驱动全部出网）。
 * 覆盖：请求形态（weapi path / 明文 URL）、字段映射（ToplistGroup/统一 Song/rank 索引推导）、
 * **列表不带歌词**（#409：内容方法零取词请求）、getNeteaseLyrics 按需取词缓存语义
 * （命中零请求 / 空词也缓存 / 失败不缓存）、getPlaylistSongs 分页+全量合一、酷狗榜单 id 规则。
 */

afterEach(() => {
  setTransport(null);
  setTransportRetryOptions(null);
  vi.restoreAllMocks();
});

/** 内存假缓存（验证 ContentCache 注入语义） */
function fakeCache(): ContentCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: <T,>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    set: <T,>(key: string, data: T) => {
      store.set(key, data);
    },
  };
}

type Responder = (req: TransportRequest) => { status: number; body: string };

/** 多路 mock：weapi path（/weapi/xxx）与明文 URL（包含匹配）分别响应 */
function mockTransport(routes: { match: (url: string) => boolean; respond: Responder }[]): TransportRequest[] {
  const seen: TransportRequest[] = [];
  setTransport(async (req) => {
    seen.push(req);
    const route = routes.find((r) => r.match(req.url));
    if (!route) throw new Error(`unexpected request: ${req.url}`);
    const { status, body } = route.respond(req);
    return { status, headers: { 'content-type': 'application/json' }, body, finalUrl: req.url };
  });
  return seen;
}

const weapiPath = (url: string) => url.replace('https://music.163.com/weapi', '');
const json = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });

/** 网易云 weapi 响应样板：playlist/detail 带 tracks */
const playlistDetail = (tracks: any[]) => ({
  code: 200,
  playlist: {
    id: 3778678,
    name: '热歌榜',
    trackIds: tracks.map((t) => ({ id: t.id })),
    tracks,
  },
});

const track = (id: number, name: string) => ({
  id,
  name,
  ar: [{ name: '歌手A' }],
  al: { name: '专辑A', picUrl: 'https://p1.music.126.net/x.jpg' },
  dt: 200000,
});

describe('neteaseDirect 内容能力（#278 迁移）', () => {
  it('getToplists：weapi /v6/playlist/detail 拉热歌/新歌榜，id 规则 ${source}:${sourceId}，返回统一 Song', async () => {
    let detailCalls = 0;
    const seen = mockTransport([
      {
        match: (u) => u.includes('/weapi/v6/playlist/detail'),
        respond: () => {
          detailCalls++;
          // weapi 密文体无法解析 id，按调用次序分别响应热歌/新歌榜
          return json(playlistDetail(detailCalls === 1 ? [track(1, '歌一'), track(2, '歌二')] : [track(3, '歌三')]));
        },
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const groups = await client.getToplists!();

    expect(groups.map((g) => g.id)).toEqual(['netease:3778678', 'netease:3779629']);
    expect(groups.map((g) => g.name)).toEqual(['热歌榜', '新歌榜']);
    expect(groups[0].songs).toHaveLength(2);
    expect(groups[0].songs[0]).toMatchObject({
      id: '1', name: '歌一', artist: '歌手A', album: '专辑A', sourceType: 'netease',
    });
    // #409：列表不再内联歌词——这是本次改动的核心断言（原实现每首歌各发一次取词请求）
    expect(groups[0].songs[0].lrc).toBe('');
    expect(seen.filter((r) => r.url.includes('/weapi/v6/playlist/detail'))).toHaveLength(2);
    expect(seen.filter((r) => r.url.includes('/api/song/lyric'))).toHaveLength(0);
  });

  it('getNeteaseLyrics：播放期按需直取；命中零请求、空词也缓存（{v} 包装）、失败不缓存', async () => {
    cacheManager.clearAll();
    // 本用例数的是「逻辑请求」次数：关掉 transport 重试，否则 5xx 会被重试 4 次（maxRetries=3）
    setTransportRetryOptions({ maxRetries: 0, baseDelayMs: 0 });
    let lyricCalls = 0;
    let fail = false;
    mockTransport([
      {
        match: (u) => u.includes('/api/song/lyric'),
        respond: (req) => {
          lyricCalls++;
          const id = new URL(req.url).searchParams.get('id');
          if (id === '1') return json({ code: 200 }); // 无 lrc 字段 = 空词
          if (fail) return { status: 500, body: '' }; // HTTP 失败
          return json({ lrc: { lyric: `[00:01.00]词${id}` } });
        },
      },
    ]);

    // 空词：取到空串，且**空词也缓存**（值包 {v} 区分「无缓存」与「确认无词」）
    expect(await getNeteaseLyrics('1')).toBe('');
    expect(lyricCalls).toBe(1);
    expect(cacheManager.get('lyric_id_1')).toEqual({ v: '' });
    expect(await getNeteaseLyrics('1')).toBe(''); // 命中缓存零请求
    expect(lyricCalls).toBe(1);

    // 失败：返回空串（歌词拿不到不该让播放失败）、且不缓存（保留重试机会）
    fail = true;
    expect(await getNeteaseLyrics('3')).toBe('');
    expect(cacheManager.get('lyric_id_3')).toBeNull();
    expect(lyricCalls).toBe(2);

    fail = false;
    expect(await getNeteaseLyrics('3')).toBe('[00:01.00]词3');
    expect(lyricCalls).toBe(3);
    expect(cacheManager.get('lyric_id_3')).toEqual({ v: '[00:01.00]词3' });
  });

  it('searchSongs：搜索结果不带歌词、零取词请求（#409）', async () => {
    const seen = mockTransport([
      {
        match: (u) => u.includes('cloudsearch'),
        respond: () => json({ code: 200, result: { songs: [track(7, '搜到的歌')] } }),
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const songs = await client.searchSongs!('晴天', 1);
    expect(songs).toHaveLength(1);
    expect(songs[0].lrc).toBe('');
    expect(seen.filter((r) => r.url.includes('/api/song/lyric'))).toHaveLength(0);
    // 列表规模与请求数解耦：一首歌一次搜索，不随结果条数放大
    expect(seen).toHaveLength(1);
  });

  it('getPlaylistSongs：分页取（offset/limit）+ limit<=0 全量；详情与播放地址同批并行', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => i + 1);
    const detail = (list: number[]) => ({ code: 200, songs: list.map((i) => track(i, `歌${i}`)) });
    let detailCalls = 0;
    const seen = mockTransport([
      { match: (u) => u.includes('/weapi/v6/playlist/detail'), respond: () => json({ code: 200, playlist: { id: 100, trackIds: ids.map((id) => ({ id })) } }) },
      {
        match: (u) => u.includes('/weapi/v3/song/detail'),
        respond: () => {
          // weapi 密文体无法解析 id，按调用次序响应：分页批 → 全量批
          detailCalls++;
          return json(detailCalls === 1 ? detail([2, 3]) : detail(ids));
        },
      },
      { match: (u) => u.includes('/song/enhance/player/url'), respond: () => json({ code: 200, data: ids.map((id) => ({ id, url: `https://cdn/${id}.mp3` })) }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());

    // 分页：offset 1 limit 2 → 歌2/歌3，total = 全量 5
    const page = await client.getPlaylistSongs!(100, 1, 2);
    expect(page.total).toBe(5);
    expect(page.songs.map((s) => s.id)).toEqual(['2', '3']);
    expect(page.songs[0].url).toContain('cdn');

    // 全量：limit <= 0 → 全部 5 首
    const full = await client.getPlaylistSongs!(200, 0, 0);
    expect(full.songs).toHaveLength(5);
    expect(seen.filter((r) => r.url.includes('/weapi/v6/playlist/detail'))).toHaveLength(2);
    // #409：5 首全量也不再逐首取词（原实现这里是 5 次 /api/song/lyric）
    expect(full.songs.every((s) => s.lrc === '')).toBe(true);
    expect(seen.filter((r) => r.url.includes('/api/song/lyric'))).toHaveLength(0);
  });

  it('getAlbumDetail：/v1/album/{id} 单请求，专辑歌曲补 URL、不带歌词（#409）', async () => {
    const seen = mockTransport([
      { match: (u) => u.includes('/weapi/v1/album/'), respond: () => json({ code: 200, album: { id: 9, name: '专辑九', artists: [{ name: '歌手A' }], picUrl: 'https://x/y.jpg' }, songs: [track(1, '歌一')] }) },
      { match: (u) => u.includes('/song/enhance/player/url'), respond: () => json({ code: 200, data: [{ id: 1, url: 'https://cdn/1.mp3' }] }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const detail = await client.getAlbumDetail!('9');
    expect(detail).not.toBeNull();
    expect(detail!.album).toMatchObject({ id: '9', name: '专辑九', artist: '歌手A' });
    expect(detail!.songs[0]).toMatchObject({ url: 'https://cdn/1.mp3', lrc: '' });
    expect(seen.filter((r) => r.url.includes('/api/song/lyric'))).toHaveLength(0);
  });

  it('getArtists：cat 透传映射 weapi /v1/artist/list type/area（1001 → 华语男）', async () => {
    let captured = '';
    mockTransport([
      {
        match: (u) => u.includes('/weapi/v1/artist/list'),
        respond: (req) => {
          captured = weapiPath(req.url);
          return json({ code: 200, artists: [{ id: 55, name: '歌手甲', picUrl: 'https://p/1.jpg', alias: [], albumSize: 3, musicSize: 30 }], more: true });
        },
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const res = await client.getArtists!(1001, 0, 30);
    expect(captured).toBe('/v1/artist/list');
    expect(res).toMatchObject({ total: 1, more: true });
    expect(res.artists[0]).toMatchObject({ id: '55', name: '歌手甲', sourceType: 'netease', albumSize: 3 });
  });

  it('getArtistDetail：合并歌手信息 + hotSongs + albums（一次调用渲染歌手页首屏）', async () => {
    mockTransport([
      { match: (u) => u.includes('/api/artist?id='), respond: () => json({ artist: { id: 55, name: '歌手甲', picUrl: 'https://p/1.jpg' } }) },
      { match: (u) => u.includes('/weapi/v1/artist/songs'), respond: () => json({ code: 200, songs: [track(1, '歌一')], total: 1 }) },
      { match: (u) => u.includes('/weapi/artist/albums/'), respond: () => json({ code: 200, hotAlbums: [{ id: 9, name: '专辑九', artists: [{ name: '歌手A' }] }], total: 1, more: false }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const detail = await client.getArtistDetail!('55');
    expect(detail.artist).toMatchObject({ id: '55', name: '歌手甲' });
    expect(detail.hotSongs[0].lrc).toBe(''); // #409：列表不带词
    expect(detail.albums[0]).toMatchObject({ id: '9', name: '专辑九' });
  });

  it('resolvePlayableUrls：批量 weapi by-ID 补直链（原 resolveNeteaseSongUrls）', async () => {
    mockTransport([
      { match: (u) => u.includes('/song/enhance/player/url'), respond: () => json({ code: 200, data: [{ id: 1, url: 'https://cdn/1.mp3' }, { id: 2, url: null }] }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const songs = [track(1, 'a'), track(2, 'b')].map((t) => ({ ...t, id: String(t.id), url: '', lrc: '', sourceType: 'netease' as const, artist: 'x', album: 'y', cover: '', duration: 1 }));
    await client.resolvePlayableUrls!(songs as Song[]);
    expect(songs[0].url).toBe('https://cdn/1.mp3');
    expect(songs[1].url).toBe(''); // VIP/无版权保持空
  });
});

describe('kugouDirect getToplists（#278 并入）', () => {
  it('v3 rank/song 请求形态（host=mobiles）+ ToplistGroup id=kugou:${rankid} + 字段映射', async () => {
    const seen = mockTransport([
      {
        match: (u) => u.includes('mobiles.kugou.com/api/v3/rank/song'),
        respond: (req) => {
          const rankid = new URL(req.url).searchParams.get('rankid');
          expect(new URL(req.url).searchParams.get('pagesize')).toBe('50');
          void rankid;
          return json({
            status: 1,
            data: {
              info: [
                { hash: 'hashA', songname: '酷狗歌', authors: [{ author_name: '酷狗歌手' }], albumname: '酷狗专辑', album_sizable_cover: 'https://imge/{size}/1.jpg', duration: 180 },
              ],
            },
          });
        },
      },
    ]);
    const groups = await kugouDirectClient.getToplists!();
    expect(groups.map((g) => g.id)).toEqual(['kugou:8888', 'kugou:74534']);
    expect(groups.map((g) => g.name)).toEqual(['热歌榜', '新歌榜']);
    expect(groups[0].songs[0]).toMatchObject({
      id: 'hashA', name: '酷狗歌', artist: '酷狗歌手', album: '酷狗专辑', sourceType: 'kugou',
    });
    expect(groups[0].songs[0].cover).toBe('https://imge/300/1.jpg');
    expect(seen.filter((r) => r.url.includes('rank/song'))).toHaveLength(2);
  });
});
