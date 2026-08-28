import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setTransport } from '../transport.js';
import {
  getQqPlaylistSongs,
  resolveQqPlaylistDisstid,
  extractQqPlaylistIdFromUrl,
  isQqSongLink,
  isQqShortLink,
  QQ_PLAYLIST_MAX_SONGS,
  resetQqPlaylistForTests,
} from '../qqPlaylist.js';

/**
 * QQ 歌单原生模块测试（#280）。
 * 接缝：transport.request（T01）——mock 传输驱动 musicu 网关与短链 302 两类请求，
 * 断言外部行为：请求形态（module/method/param/最小 comm）、字段映射、hasmore 兜底
 * 翻页与上限截断、错误边界（不存在/隐私/歌曲链接/外层 code）、缓存（10min、空不缓存）。
 */

function jsonResponse(
  body: unknown,
  extra: { headers?: Record<string, string>; finalUrl?: string; status?: number } = {},
) {
  return {
    status: extra.status ?? 200,
    headers: { 'content-type': 'application/json', ...(extra.headers ?? {}) },
    body: JSON.stringify(body),
    ...(extra.finalUrl !== undefined ? { finalUrl: extra.finalUrl } : {}),
  };
}

/** CgiGetDiss songlist 新版歌曲对象（实测字段形态）。 */
function dissTrack(mid: string, name: string) {
  return {
    id: 100 + mid.length,
    mid,
    title: name,
    singer: [{ mid: 's1', name: '周杰伦' }, { mid: 's2', name: '费玉清' }],
    album: { mid: '003OUlho2HcRHC', name: '叶惠美' },
    interval: 269.6,
  };
}

interface DissOpts {
  code?: number;
  dataCode?: number;
  hasmore?: number;
  songnum?: number;
  title?: string;
}

function dissBody(tracks: any[], opts: DissOpts = {}) {
  return {
    req_0: {
      code: opts.code ?? 0,
      data: {
        ...(opts.dataCode !== undefined ? { code: opts.dataCode } : {}),
        dirinfo: { id: 7729596131, title: opts.title ?? '我的歌单', songnum: opts.songnum ?? tracks.length },
        songlist: tracks,
        hasmore: opts.hasmore ?? 0,
        songlist_size: tracks.length,
        total_song_num: opts.songnum ?? tracks.length,
      },
    },
  };
}

beforeEach(() => {
  setTransport(null);
  resetQqPlaylistForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  setTransport(null);
  vi.restoreAllMocks();
});

describe('纯函数：链接形态识别', () => {
  it('extractQqPlaylistIdFromUrl 覆盖 web 直链与 H5 分享页', () => {
    expect(extractQqPlaylistIdFromUrl('https://y.qq.com/n/ryqq/playlist/7729596131')).toBe(7729596131);
    expect(extractQqPlaylistIdFromUrl('https://y.qq.com/n/ryqq_v2/playlist/7729596131')).toBe(7729596131);
    expect(extractQqPlaylistIdFromUrl('https://y.qq.com/n/yqq/playlist/123')).toBe(123);
    expect(extractQqPlaylistIdFromUrl('https://i.y.qq.com/n2/m/share/details/taoge.html?id=5204875759')).toBe(5204875759);
    expect(extractQqPlaylistIdFromUrl('https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=930054744&redirect_from=node_v2')).toBe(930054744);
    expect(extractQqPlaylistIdFromUrl('https://i.y.qq.com/n2/m/share/details/taoge.html?adr=1&id=5204875759&x=2')).toBe(5204875759);
  });

  it('extractQqPlaylistIdFromUrl 对短链/歌曲链接/非 QQ 链接返回 null', () => {
    expect(extractQqPlaylistIdFromUrl('https://c6.y.qq.com/base/fcgi-bin/u?__=w3lqEpOHACLO')).toBeNull();
    expect(extractQqPlaylistIdFromUrl('https://i.y.qq.com/v8/playsong.html?songmid=000XjcLg0fbRjv&type=0')).toBeNull();
    expect(extractQqPlaylistIdFromUrl('https://music.163.com/playlist?id=1')).toBeNull();
    expect(extractQqPlaylistIdFromUrl('')).toBeNull();
  });

  it('isQqSongLink 只认 playsong.html + 歌曲 id 形态', () => {
    expect(isQqSongLink('https://i.y.qq.com/v8/playsong.html?songmid=000XjcLg0fbRjv&type=0')).toBe(true);
    expect(isQqSongLink('https://i.y.qq.com/v8/playsong.html?songid=4837543')).toBe(true);
    expect(isQqSongLink('https://y.qq.com/n/ryqq/playlist/7729596131')).toBe(false);
  });

  it('isQqShortLink 认 __= 短链', () => {
    expect(isQqShortLink('https://c6.y.qq.com/base/fcgi-bin/u?__=w3lqEpOHACLO')).toBe(true);
    expect(isQqShortLink('c6.y.qq.com/base/fcgi-bin/u?__=w3lqEpOHACLO')).toBe(true);
    expect(isQqShortLink('https://y.qq.com/n/ryqq/playlist/7729596131')).toBe(false);
  });
});

describe('resolveQqPlaylistDisstid', () => {
  it('直链正则直接提取，不发任何请求', async () => {
    const transport = vi.fn();
    setTransport(transport as any);
    await expect(resolveQqPlaylistDisstid('https://y.qq.com/n/ryqq/playlist/7729596131')).resolves.toBe(7729596131);
    await expect(resolveQqPlaylistDisstid('https://i.y.qq.com/n2/m/share/details/taoge.html?id=5204875759')).resolves.toBe(5204875759);
    expect(transport).not.toHaveBeenCalled();
  });

  it('短链走 302 Location 头解析（不跟随重定向的传输）', async () => {
    const transport = vi.fn(async (req: any) => {
      expect(req.url).toBe('https://c6.y.qq.com/base/fcgi-bin/u?__=w3lqEpOHACLO');
      // 必须显式要求不跟随：真实桌面 axios 默认跟随 302，跟完既无 location 也无
      // responseURL（Node 适配器），落地地址拿不到（#280 验收实测回归）。
      expect(req.maxRedirects).toBe(0);
      return jsonResponse({}, { status: 302, headers: { location: 'https://i.y.qq.com/n2/m/share/details/taoge.html?id=5204875759&from=app' } });
    });
    setTransport(transport as any);
    await expect(resolveQqPlaylistDisstid('https://c6.y.qq.com/base/fcgi-bin/u?__=w3lqEpOHACLO')).resolves.toBe(5204875759);
  });

  it('短链走 finalUrl 落地地址解析（默认传输自动跟随重定向）', async () => {
    setTransport(
      vi.fn(async () =>
        jsonResponse({}, { finalUrl: 'https://y.qq.com/n/ryqq_v2/playlist/7729596131' }),
      ) as any,
    );
    await expect(resolveQqPlaylistDisstid('https://c6.y.qq.com/base/fcgi-bin/u?__=w3lqEpOHACLO')).resolves.toBe(7729596131);
  });

  it('短链落地为歌曲链接（playsong.html）给明确错误', async () => {
    setTransport(
      vi.fn(async () =>
        jsonResponse({}, { status: 302, headers: { location: 'https://i.y.qq.com/v8/playsong.html?songmid=000XjcLg0fbRjv&type=0' } }),
      ) as any,
    );
    await expect(resolveQqPlaylistDisstid('https://c6.y.qq.com/base/fcgi-bin/u?__=xxx')).rejects.toThrow(
      '这是 QQ 音乐歌曲链接，请分享歌单链接',
    );
  });

  it('短链失效（404）与无跳转目标给独立错误文案', async () => {
    setTransport(vi.fn(async () => ({ status: 404, headers: {}, body: 'not found', finalUrl: 'https://c6.y.qq.com/x' })) as any);
    await expect(resolveQqPlaylistDisstid('https://c6.y.qq.com/base/fcgi-bin/u?__=dead')).rejects.toThrow('QQ 短链已失效（HTTP 404）');

    setTransport(vi.fn(async () => ({ status: 200, headers: {}, body: 'ok' })) as any);
    await expect(resolveQqPlaylistDisstid('https://c6.y.qq.com/base/fcgi-bin/u?__=noredirect')).rejects.toThrow(
      'QQ 短链解析失败（未获得跳转目标）',
    );
  });

  it('歌曲直链与无法识别的链接按语义报错', async () => {
    await expect(resolveQqPlaylistDisstid('https://i.y.qq.com/v8/playsong.html?songmid=000XjcLg0fbRjv')).rejects.toThrow(
      '这是 QQ 音乐歌曲链接，请分享歌单链接',
    );
    await expect(resolveQqPlaylistDisstid('https://y.qq.com/n/ryqq/singer/004Z8Ihr0JIu5s')).rejects.toThrow('无法识别的 QQ 歌单链接');
    await expect(resolveQqPlaylistDisstid('')).rejects.toThrow('请输入 QQ 歌单链接');
  });
});

describe('getQqPlaylistSongs（CgiGetDiss 匿名直连）', () => {
  it('请求形态：musicu POST + 最小 comm + 指定 param；曲目经 mapDissTrack 映射且 url 留空', async () => {
    const transport = vi.fn(async () => jsonResponse(dissBody([dissTrack('004Z8Ihr0JIu5s', '晴天')])));
    setTransport(transport as any);

    const songs = await getQqPlaylistSongs(7729596131);

    expect(songs).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
    const req = transport.mock.calls[0][0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['Referer']).toBe('https://y.qq.com/');
    const body = JSON.parse(req.body);
    expect(body.comm).toEqual({ ct: 24, cv: 0 });
    expect(body.req_0.module).toBe('music.srfDissInfo.DissInfo');
    expect(body.req_0.method).toBe('CgiGetDiss');
    expect(body.req_0.param).toEqual({
      disstid: 7729596131,
      dirid: 0,
      song_begin: 0,
      song_num: QQ_PLAYLIST_MAX_SONGS,
      orderlist: true,
    });
    // 字段映射（新版形态）
    expect(songs[0]).toEqual({
      id: '004Z8Ihr0JIu5s',
      name: '晴天',
      artist: '周杰伦 / 费玉清',
      album: '叶惠美',
      url: '', // 播放时路由解析
      cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000003OUlho2HcRHC.jpg',
      lrc: expect.stringContaining('songmid=004Z8Ihr0JIu5s'),
      duration: 269,
      sourceType: 'qq',
    });
  });

  it('入参兼容：数字串 / 直链 / 短链统一到 disstid', async () => {
    const transport = vi.fn(async (req: any) => {
      if (req.url.includes('c6.y.qq.com')) {
        return jsonResponse({}, { headers: { location: 'https://y.qq.com/n/ryqq/playlist/7729596131' } });
      }
      return jsonResponse(dissBody([dissTrack('m1', '歌')]));
    });
    setTransport(transport as any);

    await expect(getQqPlaylistSongs('7729596131')).resolves.toHaveLength(1);
    await expect(getQqPlaylistSongs('https://y.qq.com/n/ryqq/playlist/7729596131')).resolves.toHaveLength(1);
    await expect(getQqPlaylistSongs('https://c6.y.qq.com/base/fcgi-bin/u?__=x')).resolves.toHaveLength(1);
    for (const call of transport.mock.calls) {
      if (call[0].url.includes('musicu.fcg')) {
        expect(JSON.parse(call[0].body).req_0.param.disstid).toBe(7729596131);
      }
    }
  });

  it('hasmore 兜底翻页：song_begin 按已收条数推进', async () => {
    const pages = [
      dissBody([dissTrack('m1', '歌1'), dissTrack('m2', '歌2')], { hasmore: 1, songnum: 3 }),
      dissBody([dissTrack('m3', '歌3')], { hasmore: 0, songnum: 3 }),
    ];
    let page = 0;
    const transport = vi.fn(async () => jsonResponse(pages[page++]));
    setTransport(transport as any);

    const songs = await getQqPlaylistSongs(7729596131);

    expect(songs.map((s) => s.name)).toEqual(['歌1', '歌2', '歌3']);
    expect(transport).toHaveBeenCalledTimes(2);
    const second = JSON.parse(transport.mock.calls[1][0].body).req_0.param;
    expect(second.song_begin).toBe(2);
    expect(second.song_num).toBe(QQ_PLAYLIST_MAX_SONGS - 2);
  });

  it('超大歌单封顶：达到上限即停，不再续拉并告警截断', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fullPage = Array.from({ length: QQ_PLAYLIST_MAX_SONGS }, (_, i) => dissTrack(`mid${i}`, `歌${i}`));
    const transport = vi.fn(async () => jsonResponse(dissBody(fullPage, { hasmore: 1, songnum: 5000 })));
    setTransport(transport as any);

    const songs = await getQqPlaylistSongs(7729596131);

    expect(songs).toHaveLength(QQ_PLAYLIST_MAX_SONGS);
    expect(transport).toHaveBeenCalledTimes(1); // 不追 hasmore 续拉
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出导入上限'));
  });

  it('错误边界：不存在（内层 -100006）/ 隐私歌单 / 外层非 0 code', async () => {
    setTransport(vi.fn(async () => jsonResponse(dissBody([], { dataCode: -100006 }))) as any);
    await expect(getQqPlaylistSongs(7729596131)).rejects.toThrow('QQ 歌单不存在或已被删除');

    setTransport(
      vi.fn(async () => jsonResponse(dissBody([], { title: '歌单被主人设为隐私', songnum: 0 }))) as any,
    );
    await expect(getQqPlaylistSongs(7729596131)).rejects.toThrow('该 QQ 歌单被主人设为隐私，无法导入');

    setTransport(vi.fn(async () => jsonResponse(dissBody([], { code: 500003 }))) as any);
    await expect(getQqPlaylistSongs(7729596131)).rejects.toThrow('QQ 歌单接口 code=500003');
  });

  it('标题含「隐私」但有歌曲不是隐私歌单；普通空歌单返回空', async () => {
    setTransport(vi.fn(async () => jsonResponse(dissBody([dissTrack('m1', '隐私测试歌')], { title: '隐私测试', songnum: 1 }))) as any);
    await expect(getQqPlaylistSongs(1)).resolves.toHaveLength(1);

    setTransport(vi.fn(async () => jsonResponse(dissBody([], { title: '新建歌单', songnum: 0 }))) as any);
    await expect(getQqPlaylistSongs(2)).resolves.toEqual([]);
  });

  it('缓存：命中后零请求；空结果不缓存', async () => {
    const transport = vi.fn(async () => jsonResponse(dissBody([dissTrack('m1', '歌')])));
    setTransport(transport as any);
    await getQqPlaylistSongs(7729596131);
    await getQqPlaylistSongs(7729596131);
    expect(transport).toHaveBeenCalledTimes(1);

    const emptyTransport = vi.fn(async () => jsonResponse(dissBody([], { title: '新建歌单', songnum: 0 })));
    setTransport(emptyTransport as any);
    await getQqPlaylistSongs(42);
    await getQqPlaylistSongs(42);
    expect(emptyTransport).toHaveBeenCalledTimes(2);
  });

  it('无效 disstid 与无法解析的字符串上抛', async () => {
    await expect(getQqPlaylistSongs(0)).rejects.toThrow('无效的 QQ 歌单 ID');
    await expect(getQqPlaylistSongs('https://example.com/x')).rejects.toThrow('无法识别的 QQ 歌单链接');
  });
});
