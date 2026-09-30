import { describe, expect, it } from 'vitest';
import { COVER_SIZE, coverThumbUrl } from '../coverUrl.js';

/**
 * 按源机制要缩略图（#496）。**这里锁的是安全边界**：
 * 只动实测过机制的源，其余原样返回——乱加参数会让带签名的源 403。
 */
describe('coverThumbUrl', () => {
  const netease = 'https://p2.music.126.net/vtnI8JpimWnZSzkXdmIB3w==/109951168558210782.jpg';

  it('网易：拼 ?param=WxH', () => {
    expect(coverThumbUrl(netease, 200)).toBe(netease + '?param=200y200');
    expect(coverThumbUrl(netease, COVER_SIZE.thumb)).toBe(netease + '?param=320y320');
    expect(coverThumbUrl(netease.replace('https', 'http'), 120)).toBe(
      netease.replace('https', 'http') + '?param=120y120',
    );
  });

  it('网易：已有查询串用 &，已带 param= 不重复拼（幂等）', () => {
    expect(coverThumbUrl(netease + '?x=1', 200)).toBe(netease + '?x=1&param=200y200');
    expect(coverThumbUrl(netease + '?param=100y100', 200)).toBe(netease + '?param=100y100');
  });

  it('QQ：改写路径模板 R300x300，含 _1 变体', () => {
    const base = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc123.jpg';
    expect(coverThumbUrl(base, 150)).toBe('https://y.gtimg.cn/music/photo_new/T002R150x150M000abc123.jpg');
    const v1 = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc123_1.jpg';
    expect(coverThumbUrl(v1, 500)).toBe('https://y.gtimg.cn/music/photo_new/T002R500x500M000abc123_1.jpg');
  });

  it('未验证机制的源一律原样返回（酷狗 / 酷我 / 咪咕 / 千千 / 汽水签名图）', () => {
    for (const url of [
      'https://imge.kugou.com/stdmusic/20230101/abc.jpg',
      'https://img1.kuwo.cn/star/albumcover/500/1/86/123.jpg',
      'https://cdnmusic.migu.cn/picture/2023/abc.jpg',
      'https://musicdata.baidu.com/data2/pic/abc.jpg',
      'https://p3-luna.douyinpic.com/img/abc~tplv-x.jpeg?x-expires=1&x-signature=s',
      'https://y.gtimg.cn/other/abc.jpg',
    ]) {
      expect(coverThumbUrl(url, 200), url).toBe(url);
    }
  });

  it('空值 / 本地文件 / data: 不动', () => {
    expect(coverThumbUrl('', 200)).toBe('');
    expect(coverThumbUrl('file:///tmp/a.jpg', 200)).toBe('file:///tmp/a.jpg');
    expect(coverThumbUrl('data:image/png;base64,AAA', 200)).toBe('data:image/png;base64,AAA');
  });
});
