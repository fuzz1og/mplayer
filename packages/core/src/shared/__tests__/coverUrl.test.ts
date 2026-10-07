import { describe, expect, it } from 'vitest';
import {
  COVER_SIZE,
  coverThumbUrl,
  EMBED_COVER_MAX_BYTES,
  EMBED_COVER_TIERS,
  embedCoverWithinBudget,
  embedCoverUrlChain,
} from '../coverUrl.js';

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

  /**
   * #537：QQ 的路径模板**不是**任意尺寸都能拼——CDN 只对白名单里的档位返回 200
   * （实测 120/150/180/300/500/800；200/320/1080 恒 404）。拼错档位在 UI 上表现为
   * 「封面永久灰」且不报错：v1.8.6 桌面端 QQ 全灰就是这个（行封面默认 icon 档 200）。
   */
  describe('QQ 档位白名单（#537）', () => {
    const base = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc123.jpg';
    const SUPPORTED = [120, 150, 180, 300, 500, 800];

    const requestedSize = (url: string): number => {
      const matched = /R(\d+)x\d+M/.exec(url);
      if (!matched) throw new Error('不是 QQ 路径模板：' + url);
      return Number(matched[1]);
    };

    it('每个 COVER_SIZE 档位吸附后的尺寸都在白名单里', () => {
      for (const tier of Object.values(COVER_SIZE)) {
        const size = requestedSize(coverThumbUrl(base, tier));
        expect(SUPPORTED, '档位 ' + tier + ' → ' + size).toContain(size);
      }
    });

    /**
     * 全域断言（规格原句：「QQ 源在**任何**缩略图档位下生成的 URL…不得产出 404」）：
     * `coverThumbUrl` 的 size 是任意 number，只钉 4 个 COVER_SIZE 档位兜不住这句话。
     * 修前实现按请求值原样拼 R{size}x{size}，这条会红；修后必须恒绿。
     */
    it('全域断言：1..1200 每个整数请求档都不得落到白名单外', () => {
      const outside: string[] = [];
      for (let size = 1; size <= 1200; size += 1) {
        const produced = requestedSize(coverThumbUrl(base, size));
        if (!SUPPORTED.includes(produced)) outside.push(size + ' → ' + produced);
      }
      expect(outside).toEqual([]);
    });

    it('吸附方向：向下取不超过请求值的最大档；比最小档还小取最小档', () => {
      expect(requestedSize(coverThumbUrl(base, COVER_SIZE.icon))).toBe(180);
      expect(requestedSize(coverThumbUrl(base, COVER_SIZE.thumb))).toBe(300);
      expect(requestedSize(coverThumbUrl(base, COVER_SIZE.hero))).toBe(800);
      expect(requestedSize(coverThumbUrl(base, 60))).toBe(120);
      expect(requestedSize(coverThumbUrl(base, Number.NaN))).toBe(120);
      // 超出上限：没有「不超过它的上界档」，落最大档
      expect(requestedSize(coverThumbUrl(base, Number.POSITIVE_INFINITY))).toBe(800);
    });

    it('幂等只对同一请求档成立；换更小的请求档会跟着变小（请求语义）', () => {
      const once = coverThumbUrl(base, COVER_SIZE.icon);
      expect(coverThumbUrl(once, COVER_SIZE.icon)).toBe(once);
      expect(coverThumbUrl(once, COVER_SIZE.row)).toBe(coverThumbUrl(base, COVER_SIZE.row));
    });
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

/**
 * #575：内嵌封面**自适应档位 + 字节上限**。这里锁的是降级链的形状与判据的边界：
 * 链必须从大到小、判据在上限处是**闭区间**、未验证机制的源去重后**只请求一次**
 * （不能因为多了一档就把同一张原图下两遍，那会把「省体积」改成「翻倍流量」）。
 *
 * 真机量级（#575，`Referer: https://music.163.com/`，资产 287398）：
 * 640 档 492,501 B（源图恰好 600×600 PNG，等于原图）/ 320 档 168,453 B。
 */
describe('内嵌封面降级链（#575）', () => {
  const netease = 'https://p2.music.126.net/Pzxy6py26NgNmhJjYMf2RQ==/109951169724216323.jpg';
  const qq = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc123.jpg';

  it('上限 192 KB；链为 640 → 320 且严格递减', () => {
    expect(EMBED_COVER_MAX_BYTES).toBe(192 * 1024);
    expect(EMBED_COVER_TIERS).toEqual([COVER_SIZE.embed, COVER_SIZE.thumb]);
    for (let i = 1; i < EMBED_COVER_TIERS.length; i += 1) {
      expect(EMBED_COVER_TIERS[i], '链必须从大到小').toBeLessThan(EMBED_COVER_TIERS[i - 1]);
    }
  });

  it('判据 embedCoverWithinBudget：上限处闭区间；0 / 负数 / NaN / Infinity 不算「够小」', () => {
    expect(embedCoverWithinBudget(1)).toBe(true);
    expect(embedCoverWithinBudget(EMBED_COVER_MAX_BYTES)).toBe(true);
    expect(embedCoverWithinBudget(EMBED_COVER_MAX_BYTES + 1)).toBe(false);
    // #575 实测的两个锚点：320 档可采用，640 档必须继续降档
    expect(embedCoverWithinBudget(168_453)).toBe(true);
    expect(embedCoverWithinBudget(492_501)).toBe(false);
    // 空响应体是「取图失败」，不是「够小」——不能把 0 字节当封面写进 ID3
    expect(embedCoverWithinBudget(0)).toBe(false);
    expect(embedCoverWithinBudget(-1)).toBe(false);
    expect(embedCoverWithinBudget(Number.NaN)).toBe(false);
    expect(embedCoverWithinBudget(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('候选 URL 链：网易拆成 640 / 320 两个不同 URL', () => {
    expect(embedCoverUrlChain(netease)).toEqual([
      netease + '?param=640y640',
      netease + '?param=320y320',
    ]);
  });

  it('候选 URL 链：QQ 经白名单吸附成 R500x500 / R300x300', () => {
    expect(embedCoverUrlChain(qq)).toEqual([
      'https://y.gtimg.cn/music/photo_new/T002R500x500M000abc123.jpg',
      'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc123.jpg',
    ]);
  });

  it('候选 URL 链：未验证机制的源去重成一条（不会把同一张原图下两遍）', () => {
    const kugou = 'https://imge.kugou.com/stdmusic/20230101/abc.jpg';
    expect(embedCoverUrlChain(kugou)).toEqual([kugou]);
    // 已带 param= 的网易 URL 幂等：两档算出同一个 URL，同样只请求一次
    expect(embedCoverUrlChain(netease + '?param=100y100')).toEqual([netease + '?param=100y100']);
    // 本地文件 / data: 也不动，且去重
    expect(embedCoverUrlChain('file:///tmp/a.jpg')).toEqual(['file:///tmp/a.jpg']);
    expect(embedCoverUrlChain('')).toEqual([]);
  });

  it('候选 URL 链永不长于档位链（请求次数上限 = 链长）', () => {
    for (const url of [netease, qq, 'https://imge.kugou.com/a.jpg', 'file:///tmp/a.jpg']) {
      expect(embedCoverUrlChain(url).length, url).toBeLessThanOrEqual(EMBED_COVER_TIERS.length);
    }
  });
});
