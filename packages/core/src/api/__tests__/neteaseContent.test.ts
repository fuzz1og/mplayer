import { describe, it, expect, afterEach, vi } from 'vitest';
import { setTransport, type TransportRequest } from '../transport.js';
import {
  createNeteaseDirectClient,
  defaultContentCache,
} from '../neteaseDirect.js';
import { kugouDirectClient } from '../kugouDirect.js';
import type { ContentCache } from '../../shared/sourceRouter.js';
import type { Song } from '../../types/index.js';

/**
 * 内容能力测试（#278）：接缝 = transport（mock 传输驱动全部出网）。
 * 覆盖：请求形态（weapi path / 明文 URL）、字段映射（ToplistGroup/统一 Song/rank 索引推导）、
 * fillLyrics 缓存语义（命中零请求 / 空词也缓存 / 失败不缓存）、
 * getPlaylistSongs 分页+全量合一、酷狗榜单 id 规则。
 */

afterEach(() => {
  setTransport(null);
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
      {
        match: (u) => u.includes('/api/song/lyric'),
        respond: (req) => {
          const id = new URL(req.url).searchParams.get('id');
          return json({ lrc: { lyric: `[00:01.00]歌词${id}` } });
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
    expect(groups[0].songs[0].lrc).toBe('[00:01.00]歌词1');
    // weapi 出网 2 次（两个榜单）+ 歌词 3 次（fillLyrics 每首一拉）
    expect(seen.filter((r) => r.url.includes('/weapi/v6/playlist/detail'))).toHaveLength(2);
    expect(seen.filter((r) => r.url.includes('/api/song/lyric'))).toHaveLength(3);
  });

  it('fillLyrics 缓存语义：命中零请求、空词也缓存（{v} 包装）、失败不缓存', async () => {
    let lyricCalls = 0;
    let fail = false;
    const seen = mockTransport([
      {
        match: (u) => u.includes('cloudsearch'),
        respond: (req) => {
          const body = new URLSearchParams(req.body);
          const kw = body.get('s') || '';
          return json({
            code: 200,
            result: { songs: kw === 'x' ? [track(1, '纯音乐'), track(2, '正常歌')] : [track(3, '故障歌')] },
          });
        },
      },
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
    const cache = fakeCache();
    const client = createNeteaseDirectClient(cache);

    // 第一次搜索：纯音乐拉到空词（缓存）、正常歌拉到词
    await client.searchSongs!('x', 1);
    expect(lyricCalls).toBe(2);
    // 空词已缓存（值包 {v} 对象区分「无缓存」与「确认无词」）
    expect(cache.store.get('lyric_id_1')).toEqual({ v: '' });

    // 第二次搜索：两首都命中缓存零请求（防刷新页面大量拉词）
    await client.searchSongs!('x', 1);
    expect(lyricCalls).toBe(2);

    // 失败不缓存（HTTP 500 抛错，保留重试机会）
    fail = true;
    await client.searchSongs!('y', 1);
    const callsAfterFail = lyricCalls;
    expect(cache.store.has('lyric_id_3')).toBe(false);
    fail = false;
    await client.searchSongs!('y', 1);
    expect(lyricCalls).toBe(callsAfterFail + 1); // 故障歌重试成功
    expect(cache.store.get('lyric_id_3')).toEqual({ v: '[00:01.00]词3' });
    void seen;

    // 默认 ContentCache（cacheManager 包装）get/set 语义等价
    expect(defaultContentCache.get('not-exist')).toBeNull();
  });

  it('searchSongs：搜索结果同样内联歌词（#242：直连搜索天然无 lrc 字段）', async () => {
    const seen = mockTransport([
      {
        match: (u) => u.includes('cloudsearch'),
        respond: () => json({ code: 200, result: { songs: [track(7, '搜到的歌')] } }),
      },
      { match: (u) => u.includes('/api/song/lyric'), respond: (req) => json({ lrc: { lyric: `[00:01.00]词${new URL(req.url).searchParams.get('id')}` } }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const songs = await client.searchSongs!('晴天', 1);
    expect(songs).toHaveLength(1);
    expect(songs[0].lrc).toBe('[00:01.00]词7');
    expect(seen.filter((r) => r.url.includes('/api/song/lyric'))).toHaveLength(1);
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
      { match: (u) => u.includes('/api/song/lyric'), respond: (req) => json({ lrc: { lyric: `[00:01.00]词${new URL(req.url).searchParams.get('id')}` } }) },
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
  });

  it('getAlbumDetail：/v1/album/{id} 单请求，专辑歌曲补 URL + 内联歌词', async () => {
    mockTransport([
      { match: (u) => u.includes('/weapi/v1/album/'), respond: () => json({ code: 200, album: { id: 9, name: '专辑九', artists: [{ name: '歌手A' }], picUrl: 'https://x/y.jpg' }, songs: [track(1, '歌一')] }) },
      { match: (u) => u.includes('/song/enhance/player/url'), respond: () => json({ code: 200, data: [{ id: 1, url: 'https://cdn/1.mp3' }] }) },
      { match: (u) => u.includes('/api/song/lyric'), respond: () => json({ lrc: { lyric: '[00:01.00]词1' } }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const detail = await client.getAlbumDetail!('9');
    expect(detail).not.toBeNull();
    expect(detail!.album).toMatchObject({ id: '9', name: '专辑九', artist: '歌手A' });
    expect(detail!.songs[0]).toMatchObject({ url: 'https://cdn/1.mp3', lrc: '[00:01.00]词1' });
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
      { match: (u) => u.includes('/api/song/lyric'), respond: () => json({ lrc: { lyric: '[00:01.00]词1' } }) },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const detail = await client.getArtistDetail!('55');
    expect(detail.artist).toMatchObject({ id: '55', name: '歌手甲' });
    expect(detail.hotSongs[0].lrc).toBe('[00:01.00]词1');
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
  it('mobilecdn rank/song 请求形态 + ToplistGroup id=kugou:${rankid} + 字段映射', async () => {
    const seen = mockTransport([
      {
        match: (u) => u.includes('mobilecdn.kugou.com/api/v3/rank/song'),
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
    expect(groups[0].songs[0].cover).toBe('https://imge/300x300/1.jpg');
    expect(seen.filter((r) => r.url.includes('rank/song'))).toHaveLength(2);
  });
});
