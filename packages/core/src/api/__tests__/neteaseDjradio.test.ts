import { afterEach, describe, expect, it } from 'vitest';
import { setTransport, setTransportRetryOptions, type TransportRequest } from '../transport.js';
import { createNeteaseDirectClient } from '../neteaseDirect.js';
import type { ContentCache } from '../../shared/sourceRouter.js';

afterEach(() => {
  setTransport(null);
  setTransportRetryOptions(null);
});

function fakeCache(): ContentCache {
  const store = new Map<string, unknown>();
  return {
    get: <T,>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    set: <T,>(key: string, data: T) => {
      store.set(key, data);
    },
  };
}

type Responder = (req: TransportRequest) => { status: number; body: string };

function mockTransport(routes: { match: (url: string) => boolean; respond: Responder }[]): TransportRequest[] {
  const seen: TransportRequest[] = [];
  setTransport(async (req) => {
    seen.push(req);
    const route = routes.find((item) => item.match(req.url));
    if (!route) throw new Error(`unexpected request: ${req.url}`);
    const { status, body } = route.respond(req);
    return { status, headers: { 'content-type': 'application/json' }, body, finalUrl: req.url };
  });
  return seen;
}

const json = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });

const radio = {
  id: 1003897323,
  name: 'AI 陶喆',
  picUrl: 'http://p2.music.126.net/radio.jpg',
  desc: '电台简介',
  programCount: 133,
  subCount: 11625,
  shareCount: 87,
  commentCount: 192,
  createTime: 1713869429607,
  lastProgramCreateTime: 1793794952345,
  lastProgramId: 3731935266,
  category: '创作翻唱',
  secondCategory: '歌曲翻唱',
  dj: {
    userId: 79952226,
    nickname: '邪热搜索',
    avatarUrl: 'http://p1.music.126.net/avatar.jpg',
    signature: '签名',
  },
};

const program = {
  id: 3731935266,
  name: '读心术陶第二版',
  serialNum: 126,
  duration: 191173,
  createTime: 1793794952345,
  listenerCount: 2195,
  coverUrl: 'http://p2.music.126.net/program.jpg',
  description: '单期简介',
  programDesc: [{ type: 1, content: '单期简介' }],
  mainTrackId: 3457566808,
  radio: { ...radio, picUrl: 'http://p2.music.126.net/radio.jpg' },
  mainSong: {
    id: 3457566808,
    name: '读心术陶第二版',
    duration: 191173,
    fee: 0,
    copyright: 1,
    artists: [{ name: '邪热搜索', id: 0 }],
    album: { id: 0, name: null },
  },
};

describe('neteaseDirect DJ 电台（#742）', () => {
  it('getDjRadioDetail：POST id、映射元数据、404 返回 null、命中缓存零请求', async () => {
    let calls = 0;
    const seen = mockTransport([
      {
        match: (url) => url.includes('/api/djradio/v2/get'),
        respond: () => {
          calls += 1;
          return json({ code: 200, data: radio });
        },
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());

    const detail = await client.getDjRadioDetail!('1003897323');
    expect(detail).toMatchObject({
      id: '1003897323',
      name: 'AI 陶喆',
      picUrl: 'https://p2.music.126.net/radio.jpg',
      dj: { userId: '79952226', nickname: '邪热搜索', avatarUrl: 'https://p1.music.126.net/avatar.jpg' },
      programCount: 133,
      subCount: 11625,
      sourceType: 'netease',
    });
    expect(new URLSearchParams(seen[0].body).get('id')).toBe('1003897323');

    await client.getDjRadioDetail!('1003897323');
    expect(calls).toBe(1);

    mockTransport([
      { match: (url) => url.includes('/api/djradio/v2/get'), respond: () => json({ code: 404, msg: 'radio not exist' }) },
    ]);
    expect(await createNeteaseDirectClient(fakeCache()).getDjRadioDetail!('999')).toBeNull();
  });

  it('getDjRadioPrograms：mainSong.id 作 Song.id、program.id 只作内容身份、时长毫秒转秒', async () => {
    const seen = mockTransport([
      {
        match: (url) => url.includes('/api/dj/program/byradio'),
        respond: () => json({ code: 200, count: 126, more: true, programs: [program] }),
      },
    ]);
    const page = await createNeteaseDirectClient(fakeCache()).getDjRadioPrograms!('1003897323', 0, 30, true);
    expect(page).toMatchObject({ total: 126, more: true });
    expect(page.programs[0]).toMatchObject({
      id: '3457566808',
      programId: '3731935266',
      radioId: '1003897323',
      name: '读心术陶第二版',
      artist: '邪热搜索',
      album: 'AI 陶喆',
      duration: 191,
      serialNum: 126,
      cover: 'https://p2.music.126.net/program.jpg',
      lrc: '',
      sourceType: 'netease',
    });
    const body = new URLSearchParams(seen[0].body);
    expect(body.get('asc')).toBe('true');
    expect(body.get('limit')).toBe('30');
  });

  it('getArtistRadios：按 userId 取电台；getArtistInfo 带出 accountId', async () => {
    const seen = mockTransport([
      {
        match: (url) => url.includes('/api/djradio/get/byuser'),
        respond: () => json({ code: 200, count: 1, hasMore: false, subCount: 2299, items: [radio] }),
      },
      {
        match: (url) => url.includes('/api/v1/artist/12084453'),
        respond: () => json({ artist: { id: 12084453, name: '邪热搜索', picUrl: 'https://p/artist.jpg', alias: [], albumSize: 11, musicSize: 15, accountId: 79952226 } }),
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());
    const page = await client.getArtistRadios!('79952226');
    expect(page).toMatchObject({ total: 1, more: false, subCount: 2299 });
    expect(page.radios[0]).toMatchObject({ id: '1003897323', name: 'AI 陶喆', sourceType: 'netease' });
    expect(new URLSearchParams(seen[0].body).get('userId')).toBe('79952226');

    const artist = await client.getArtistInfo!('12084453');
    expect(artist).toMatchObject({ id: '12084453', name: '邪热搜索', accountId: '79952226' });
  });

  it('searchDjRadios：cloudsearch type=1009，映射 top 10 结果', async () => {
    const seen = mockTransport([
      {
        match: (url) => url.includes('/api/cloudsearch/pc'),
        respond: () => json({ code: 200, result: { items: [radio], djRadiosCount: 1 } }),
      },
    ]);
    const radios = await createNeteaseDirectClient(fakeCache()).searchDjRadios!('AI 陶喆');
    expect(radios).toHaveLength(1);
    expect(radios[0]).toMatchObject({ id: '1003897323', name: 'AI 陶喆', sourceType: 'netease' });
    const body = new URLSearchParams(seen[0].body);
    expect(body.get('type')).toBe('1009');
    expect(body.get('limit')).toBe('10');
  });

  it('406 抛可读错误且不缓存；下一次仍会重试', async () => {
    let calls = 0;
    mockTransport([
      {
        match: (url) => url.includes('/api/djradio/v2/get'),
        respond: () => {
          calls += 1;
          return json({ code: 406, msg: '操作频繁' });
        },
      },
    ]);
    const client = createNeteaseDirectClient(fakeCache());

    await expect(client.getDjRadioDetail!('1003897323')).rejects.toThrow(/code=406.*操作频繁/);
    await expect(client.getDjRadioDetail!('1003897323')).rejects.toThrow(/code=406/);
    expect(calls).toBe(2);
  });

  it('同键并发只打一发；空节目列表不缓存', async () => {
    const seen: TransportRequest[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setTransport(async (req) => {
      seen.push(req);
      await gate;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 200, count: 0, more: false, programs: [] }),
        finalUrl: req.url,
      };
    });
    const client = createNeteaseDirectClient(fakeCache());

    const first = client.getDjRadioPrograms!('1003897323', 0, 30);
    const second = client.getDjRadioPrograms!('1003897323', 0, 30);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toHaveLength(1);

    release();
    await expect(first).resolves.toEqual({ programs: [], total: 0, more: false });
    await expect(second).resolves.toEqual({ programs: [], total: 0, more: false });

    await client.getDjRadioPrograms!('1003897323', 0, 30);
    expect(seen).toHaveLength(2);
  });
});
