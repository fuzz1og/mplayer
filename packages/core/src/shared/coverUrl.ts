/**
 * 封面 URL 提速：按**源 CDN 的机制**要缩略图（#496）。
 *
 * 各源机制**不一样**——这正是它属于 core（多源知识）而不是某一端的原因：
 *
 * | 源 | CDN | 机制 | 证据 |
 * | --- | --- | --- | --- |
 * | 网易 | `p*.music.126.net` | 查询参数 `?param=WxH` | 实测 272 KB → 94 KB(1080) / 14.5 KB(320) / 7 KB(200) / 3.3 KB(120) |
 * | QQ | `y.gtimg.cn` | **路径模板**，但档位是**白名单**（不是任意尺寸；见 `QQ_CDN_TIERS`） | 实测 8 个专辑 mid 结果一致：200 / 320 / 1080 恒 404（#537） |
 * | 酷狗 | `imge.kugou.com` | URL 里的 `{size}` 占位符，映射时已替换成 300（见 `kugouDirect`） | 已是 300，无需再改 |
 * | 酷我 / 咪咕 / 千千 / 汽水 | — | 未验证 | **原样返回**（宁可不省，不可改坏） |
 *
 * 未命中白名单的 URL 一律原样返回：有些源带签名 / 防盗链（如汽水的 `douyinpic`），
 * 乱加查询参数会 403 —— 安全默认是「不动」。
 *
 * **路径模板不等于任意尺寸**（#537）：改写成 CDN 上不存在的档位拿到的是 404，在 UI 上表现为
 * 「封面永久灰」且没有任何报错（v1.8.6 桌面端 QQ 全灰就是这个）。所以「按尺寸拼路径」的源，
 * 拼 URL 前必须先吸附到实测存在的档位（见 `QQ_CDN_TIERS` / `snapToQqTier`）。
 *
 * 新增一个源：拿真实 URL → 试候选写法 → **按字节数对比**（变小且仍是 200 才算通过）；
 * 路径模板型的源还要把**每个** `COVER_SIZE` 档位各请求一次，把真实存在的那些抄成白名单 →
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
  /**
   * 内嵌进音频文件的封面（下载打标）：给系统/第三方播放器看，不需要 hero 档。
   * **网易档位的字节数不是单调的**（实测同一张图 500 档 73 KB 反而大于 640 档 41 KB），
   * 所以这里取已实测的 640（QQ 白名单会向下吸附到存在的 500 档）。
   */
  embed: 640,
} as const;

const NETEASE_HOST = /^https?:\/\/p\d+\.music\.126\.net\//;
const QQ_HOST = /^https?:\/\/(y\.gtimg\.cn|y\.qq\.com|qpic\.y\.qq\.com)\//;
const QQ_TEMPLATE = /R\d+x\d+M/;

/**
 * QQ 封面路径模板**真实存在**的档位（实测 #537；8 个专辑 mid 与 `_1` 变体结果一致）——
 * 不在表里的尺寸 CDN 一律 404，所以这是一张**白名单**而不是一个范围。
 *
 * 与 `COVER_SIZE` 不是一回事：那个是**请求档**（按显示尺寸估的档位），本表是 **CDN 实际存在的
 * 档位**；请求档要经 `snapToQqTier` 落到本表。必须**升序**（吸附实现依赖有序），改动时一并改测试。
 */
const QQ_CDN_TIERS = [120, 150, 180, 300, 500, 800] as const;

/**
 * 把「请求档」吸附到 QQ 真实存在的档位：取 `QQ_CDN_TIERS` 里**不超过请求值的最大档**；
 * 请求值比最小档还小、或不是有效数字（`NaN`）时取最小档。
 *
 * 方向是**向下取**（icon 200 → 180、thumb 320 → 300、hero 1080 → 800），不是向上：
 * 请求档只是「够用就好」的估计，落小一档只少几 KB，落一个不存在的档却是整块灰；
 * 超出上限的值（如 `+Infinity`）没有「不超过它」的上界，自然落到最大档 800。
 *
 * **幂等只对同一请求档成立**：拿一个更小的请求档重算，结果会跟着变小——那是请求语义
 * （调用方要 120 就给 120 档），不是吸附不稳定。
 */
function snapToQqTier(size: number): number {
  let snapped: number = QQ_CDN_TIERS[0];
  for (const tier of QQ_CDN_TIERS) {
    if (tier <= size) snapped = tier;
  }
  return snapped;
}

/**
 * 把封面 URL 改写成「请求 size×size 缩略图」的写法；**不认识的源原样返回**。
 *
 * 对档位是白名单的源（QQ），`size` 是**请求档**，返回的 URL 尺寸是吸附后的值，
 * **不一定等于请求值**（200 → 180）。幂等：已带 `param=` 的网易 URL、非 http（file:// / data:）
 * 与空值都不动；QQ 在同一请求档下重复调用不变。
 */
export function coverThumbUrl(url: string, size: number = COVER_SIZE.thumb): string {
  if (!url || !/^https?:\/\//.test(url)) return url;
  if (NETEASE_HOST.test(url)) {
    if (url.includes('param=')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'param=' + size + 'y' + size;
  }
  if (QQ_HOST.test(url) && QQ_TEMPLATE.test(url)) {
    const snapped = snapToQqTier(size);
    return url.replace(QQ_TEMPLATE, 'R' + snapped + 'x' + snapped + 'M');
  }
  return url;
}
