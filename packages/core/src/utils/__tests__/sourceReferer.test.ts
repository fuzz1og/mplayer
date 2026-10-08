import { describe, it, expect } from 'vitest';
import {
  BROWSER_UA,
  refererForUrl,
  refererForSourceKey,
  refererForApiType,
  requestHeadersFor,
} from '../sourceReferer';

describe('sourceReferer', () => {
  it('按 api.php type 参数返回对应 Referer', () => {
    expect(refererForUrl('https://example.com/api.php?type=kg&id=1')).toBe('https://www.kugou.com/');
    expect(refererForUrl('https://example.com/api.php?type=netease')).toBe('https://music.163.com/');
  });

  it('QQ 歌词 fcg 使用播放器页 Referer（防盗链要求）', () => {
    expect(refererForUrl('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=abc')).toBe(
      'https://y.qq.com/portal/player.html',
    );
  });

  it('酷我/酷狗歌词域名返回官方站点 Referer', () => {
    expect(refererForUrl('http://newlyric.kuwo.cn/newlyric.lrc?x=1')).toBe('https://www.kuwo.cn/');
    expect(refererForUrl('http://lyrics.kugou.com/search?hash=abc')).toBe('https://www.kugou.com/');
  });

  it('未知 URL 不返回 Referer', () => {
    expect(refererForUrl('https://cdn.example.com/a.mp3')).toBeUndefined();
  });

  it('refererForSourceKey / refererForApiType 基础映射', () => {
    expect(refererForSourceKey('qq')).toBe('https://y.qq.com/');
    expect(refererForApiType('wy')).toBe('https://music.163.com/');
  });
});

// #592（结构半）：每源播放/下载请求头的唯一事实来源。拼装点：移动端 expo-audio
// 回落路径、内嵌封面、core 直连腿取证都取这一份。Android 原生那条路（nativePlayer
// 的空壳）不在本笔，见 ADR。
describe('requestHeadersFor（#592 单点）', () => {
  it('已知源：UA + 对应官方站点 Referer', () => {
    expect(requestHeadersFor('netease')).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://music.163.com/',
    });
    expect(requestHeadersFor('qq')).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://y.qq.com/',
    });
    expect(requestHeadersFor('kugou')).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://www.kugou.com/',
    });
    expect(requestHeadersFor('kuwo')).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://www.kuwo.cn/',
    });
    expect(requestHeadersFor('qianqian')).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://music.qianqian.com/',
    });
    expect(requestHeadersFor('migu')).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://music.migu.cn/',
    });
  });

  it('api.php 形状的 key（wy/kg）同样命中', () => {
    expect(requestHeadersFor('wy').Referer).toBe('https://music.163.com/');
    expect(requestHeadersFor('kg').Referer).toBe('https://www.kugou.com/');
  });

  it.each([undefined, '', 'local', 'soda', '不存在的源'])(
    '未知源/缺省/local：只带 UA，不带 Referer（source=%s）',
    (source) => {
      const headers = requestHeadersFor(source);
      expect(headers['User-Agent']).toBe(BROWSER_UA);
      expect('Referer' in headers).toBe(false);
    },
  );

  it('每次返回新对象（调用方改写不污染源表/别的调用方）', () => {
    const a = requestHeadersFor('qq');
    const b = requestHeadersFor('qq');
    expect(a).not.toBe(b);
    a.Referer = 'https://evil.example/';
    expect(requestHeadersFor('qq').Referer).toBe('https://y.qq.com/');
    expect(b.Referer).toBe('https://y.qq.com/');
  });
});
