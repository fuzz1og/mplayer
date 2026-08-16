import { describe, it, expect } from 'vitest';
import { refererForUrl, refererForSourceKey, refererForApiType } from '../sourceReferer';

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
