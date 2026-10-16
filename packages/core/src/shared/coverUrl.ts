/**
 * 封面 URL 提速：按**源 CDN 的机制**要缩略图（#496）。
 * 未命中白名单的 URL 一律原样返回：有些源带签名 / 防盗链（如汽水的 `douyinpic`），乱加查询参数会 
 * 403 —— 安全默认是「不动」。
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
   * 它是降级链的**起点**而非唯一档位（`EMBED_COVER_TIERS` = 640 → 320）：#575 实测「源图恰好 
   * 600×600 的 PNG」上 640 档等于原图 492 KB，会在字节上限处降到 320 档（168 KB）。
   */
  embed: 640,
} as const;

/**
 * 取值理由（2026-10-08 host 侧实测，`Referer: https://music.163.com/`，网易热歌榜前 20 首 +#575 的
 * 资产 287398）：640 档的字节数在样本里是**双峰**的——15/20 落在 4–182 KB（本来就便宜），5/20 落
 * 在 211 KB–1.01 MB（`?param=640y640` 在「源图恰好 ≤640px」时等于原图，整张 PNG 灌进来）。
 */
export const EMBED_COVER_MAX_BYTES = 192 * 1024;

/**
 * 内嵌封面的**降级链**（#575）：从大到小依次取图，首个「够小」（见 `embedCoverWithinBudget`）的采用
 * ；全超上限时采用链中**最小的最后一份**（由调用方 `fetchEmbeddableCover` 兜底，该份可能 > 
 * `EMBED_COVER_MAX_BYTES`）。
 */
export const EMBED_COVER_TIERS: readonly number[] = [COVER_SIZE.embed, COVER_SIZE.thumb];

const NETEASE_HOST = /^https?:\/\/p\d+\.music\.126\.net\//;
const QQ_HOST = /^https?:\/\/(y\.gtimg\.cn|y\.qq\.com|qpic\.y\.qq\.com)\//;
const QQ_TEMPLATE = /R\d+x\d+M/;

/**
 * QQ 封面路径模板**真实存在**的档位（实测 #537；8 个专辑 mid 与 `_1` 变体结果一致）——不在表里的尺
 * 寸 CDN 一律 404，所以这是一张**白名单**而不是一个范围。
 * 必须**升序**（吸附实现依赖有序），改动时一并改测试。
 */
const QQ_CDN_TIERS = [120, 150, 180, 300, 500, 800] as const;

/**
 * 把「请求档」吸附到 QQ 真实存在的档位：取 `QQ_CDN_TIERS` 里**不超过请求值的最大档**；请求值比最小
 * 档还小、或不是有效数字（`NaN`）时取最小档。
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
 * 对档位是白名单的源（QQ），`size` 是**请求档**，返回的 URL 尺寸是吸附后的值，**不一定等于请求值**
 * （200 → 180）。
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
 * 空响应体是取图失败，不能当封面写进 ID3；无穷大则是「永远超上限」的自然表达（`Infinity` 不会被误判
 * 成够小）。
 */
export function embedCoverWithinBudget(byteLength: number): boolean {
  return Number.isFinite(byteLength) && byteLength > 0 && byteLength <= EMBED_COVER_MAX_BYTES;
}

/**
 * 把一张封面 URL 展开成**按降级链去重后的候选序列**（`EMBED_COVER_TIERS` 逐个过`coverThumbUrl`，同
 * 一 URL 只留一次）。
 * 空 URL 返回 `[]`（无候选，调用方直接放弃）。
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
