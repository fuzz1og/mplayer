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
   * 它是降级链的**起点**而非唯一档位（`EMBED_COVER_TIERS` = 640 → 320）：#575 实测
   * 「源图恰好 600×600 的 PNG」上 640 档等于原图 492 KB，会在字节上限处降到 320 档（168 KB）。
   * **网易档位的字节数不是单调的**（实测同一张图 500 档 73 KB 反而大于 640 档 41 KB），
   * 所以起点取已实测的 640（QQ 白名单会向下吸附到存在的 500 档）。
   */
  embed: 640,
} as const;

/**
 * 内嵌封面的**字节上限**（#575）：降级链上某档取到的字节数 `≤` 本值就采用，不再往下降。
 *
 * 取值理由（2026-10-08 host 侧实测，`Referer: https://music.163.com/`，网易热歌榜前 20 首 +
 * #575 的资产 287398）：640 档的字节数在样本里是**双峰**的——15/20 落在 4–182 KB（本来就便宜），
 * 5/20 落在 211 KB–1.01 MB（`?param=640y640` 在「源图恰好 ≤640px」时等于原图，整张 PNG 灌进来）。
 * 192 KB = 196,608 B 落在这两簇之间的空档（便宜簇最大 181,943 B < 阈值 < 贵簇最小 211,540 B），
 * 对这批样本，182–211 KB 间任何取值决策都一样；取 192 KB 只是好记。**别只按某个源调这个数**——
 * 它是「要不要为了封面多花 ~0.19 MB」的产品取舍，改动要同步 ADR 2026-10-04 决策 9。
 */
export const EMBED_COVER_MAX_BYTES = 192 * 1024;

/**
 * 内嵌封面的**降级链**（#575）：从大到小依次取图，首个「够小」（见 `embedCoverWithinBudget`）
 * 的采用；全超上限时采用链中**最小的最后一份**（由调用方 `fetchEmbeddableCover` 兜底）。
 *
 * 顺序即「先清晰、后省体积」的取舍顺序；**请求次数上限 = 链长**（`embedCoverUrlChain` 还会对
 * 等价 URL 去重）。改动链要一并改测试与 ADR。
 */
export const EMBED_COVER_TIERS: readonly number[] = [COVER_SIZE.embed, COVER_SIZE.thumb];

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

/**
 * 纯判据：已取到的这一份**是否已经够小、可以采用**（`true` = 停止降档）。
 *
 * - `0 < byteLength ≤ EMBED_COVER_MAX_BYTES` → 采用；
 * - 超上限 → 继续往链的下一个（更小）档位走（由调用方负责，core 不替它发请求）；
 * - `0` / 负数 / `NaN` / `Infinity` → **不是**「够小」。空响应体是取图失败，不能当封面写进 ID3；
 *   无穷大则是「永远超上限」的自然表达（`Infinity` 不会被误判成够小）。
 *
 * 上限处是**闭区间**：正好 192 KB 采用（`>` 才降档）。
 */
export function embedCoverWithinBudget(byteLength: number): boolean {
  return Number.isFinite(byteLength) && byteLength > 0 && byteLength <= EMBED_COVER_MAX_BYTES;
}

/**
 * 把一张封面 URL 展开成**按降级链去重后的候选序列**（`EMBED_COVER_TIERS` 逐个过
 * `coverThumbUrl`，同一 URL 只留一次）。
 *
 * 去重是必需的，不是优化：未验证机制的源（酷狗/酷我/咪咕/千千/汽水）在每个档位都**原样返回**，
 * 不去重就会把同一张原图下两遍——把「省体积」变成「翻倍流量」。空 URL 返回 `[]`（无候选，调用方
 * 直接放弃）。
 */
export function embedCoverUrlChain(coverUrl: string): string[] {
  if (!coverUrl) return [];
  const out: string[] = [];
  for (const size of EMBED_COVER_TIERS) {
    const url = coverThumbUrl(coverUrl, size);
    if (!out.includes(url)) out.push(url);
  }
  return out;
}
