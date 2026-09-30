/**
 * 封面 URL 提速：按**源 CDN 的机制**要缩略图（#496）。
 *
 * 各源机制**不一样**——这正是它属于 core（多源知识）而不是某一端的原因：
 *
 * | 源 | CDN | 机制 | 证据 |
 * | --- | --- | --- | --- |
 * | 网易 | `p*.music.126.net` | 查询参数 `?param=WxH` | 实测 272 KB → 94 KB(1080) / 14.5 KB(320) / 7 KB(200) / 3.3 KB(120) |
 * | QQ | `y.gtimg.cn` | **路径模板**里的 `R300x300`（core 生成 URL 时就是它，见 `qqDirect`） | 机制已知；字节待复测 |
 * | 酷狗 | `imge.kugou.com` | URL 里的 `{size}` 占位符，映射时已替换成 300（见 `kugouDirect`） | 已是 300，无需再改 |
 * | 酷我 / 咪咕 / 千千 / 汽水 | — | 未验证 | **原样返回**（宁可不省，不可改坏） |
 *
 * 未命中白名单的 URL 一律原样返回：有些源带签名 / 防盗链（如汽水的 `douyinpic`），
 * 乱加查询参数会 403 —— 安全默认是「不动」。
 *
 * 新增一个源：拿真实 URL → 试候选写法 → **按字节数对比**（变小且仍是 200 才算通过）→
 * 加进本文件的规则并补一行实测；测试见 `__tests__/coverUrl.test.ts`。
 */

/** 各端共用的封面尺寸档位（一律取显示尺寸的 2×；不是精确像素，只是档位） */
export const COVER_SIZE = {
  /** 歌曲行（约 44–48dp，列表里数量最多） */
  row: 120,
  /** 小图标：迷你播放栏、桌面列表图标 */
  icon: 200,
  /** 列表 / 网格卡片 */
  thumb: 320,
  /** 全出血 Hero / 全屏播放器 */
  hero: 1080,
} as const;

const NETEASE_HOST = /^https?:\/\/p\d+\.music\.126\.net\//;
const QQ_HOST = /^https?:\/\/(y\.gtimg\.cn|y\.qq\.com|qpic\.y\.qq\.com)\//;
const QQ_TEMPLATE = /R\d+x\d+M/;

/**
 * 把封面 URL 改写成「请求 size×size 缩略图」的写法；**不认识的源原样返回**。
 * 幂等：已带 `param=` 的网易 URL、非 http（file:// / data:）与空值都不动。
 */
export function coverThumbUrl(url: string, size: number = COVER_SIZE.thumb): string {
  if (!url || !/^https?:\/\//.test(url)) return url;
  if (NETEASE_HOST.test(url)) {
    if (url.includes('param=')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'param=' + size + 'y' + size;
  }
  if (QQ_HOST.test(url) && QQ_TEMPLATE.test(url)) {
    return url.replace(QQ_TEMPLATE, 'R' + size + 'x' + size + 'M');
  }
  return url;
}
