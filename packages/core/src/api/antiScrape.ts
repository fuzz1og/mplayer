/**
 * 反爬工具模块（T11 spec #157 G2 P1 请求硬化）
 *
 * 提供 User-Agent 轮换（扩池至 50 条 + 反同源连续）、速率限制、随机延迟、增强请求头等能力。
 *
 * T11 变更点（对照 r2-robustness-gap G2 决策）：
 * - UA 池从硬编码 10 条扩至 50 条真实浏览器 UA（近 3 年各版本/内核覆盖）；
 * - 「反同源连续」：同一源相邻请求尽量不重复同一 UA（按 `sourceKey` 独立轨道，
 *   不带 sourceKey 走默认轨道，保证跨源也不连续）；循环一轮耗尽后按轮转补位；
 * - 请求头「两态」：
 *   - 浏览器态 `getAntiScrapeHeaders(referer?, sourceKey?)` —— 源站直连/CDN 防盗链
 *     用，携带 sec-ch 满套 + 按 referer 的 `Sec-Fetch-Site`；
 *   - API 态 `getApiRequestHeaders(sourceKey?)` —— 自建搜索 API / 稳定 JSON 端点用，
 *     最小头、不带 sec-ch 套、默认不带 Referer（不污染直连/自有 API）；
 * - `safeParseJSON(text)`：非 JSON/HTML 包裹/尾逗号等脆弱响应三级降级，失败返回 null
 *   不抛（源站偶发非 JSON 不炸链路）。决策：默认启用但保守——不启用随机 IP 头、
 *   XFF 不采纳（见 r2 §5b）。
 */

// ── User-Agent 池（50 条真实浏览器 UA，T11 扩池至 30–50，取满 50）─────
//
// 覆盖近 3 年 Chrome/Edge/Chromium(Samsung)/Firefox/Safari 各版本与桌面/移动端。
// 值均为真实浏览器 UA 字符串（含版本兜底），供反同源连续轮换。

export const UA_POOL_SIZE = 50;

const USER_AGENTS: readonly string[] = [
  // Chrome 桌面（Windows）
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Chrome 桌面（macOS）
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  // Chrome 桌面（Linux）
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  // Edge 桌面（Windows，Chromium 内核、版本跟随）
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.0.0',
  // Firefox 桌面
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0',
  // Safari 桌面（macOS）
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15',
  // Chrome 移动（Android）
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Redmi Note 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 11; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  // Safari / iOS WebView 移动
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
  // Gecko 移动（Android 浏览器 / Firefox Android）
  'Mozilla/5.0 (Android 13; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',
  'Mozilla/5.0 (Android 12; Mobile; rv:123.0) Gecko/123.0 Firefox/123.0',
  // Samsung Internet（Chromium 内核，版本跟随 Chromium）
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/21.0 Chrome/110.0.0.0 Mobile Safari/537.36',
  // 补充 Chrome 历史稳定版（桌面）填满 50
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
  // 补充 Edge 历史稳定版
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36 Edg/111.0.0.0',
  // 补充 Firefox 移动/桌面历史
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:117.0) Gecko/20100101 Firefox/117.0',
  'Mozilla/5.0 (Android 11; Mobile; rv:116.0) Gecko/116.0 Firefox/116.0',
  // 补充其他内核/去指纹化的常见 UA（Opera / Vivaldi 均 Chromium）
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/108.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/106.0.0.0',
] as const;

if (USER_AGENTS.length !== UA_POOL_SIZE) {
  throw new Error(`UA 池长度${USER_AGENTS.length}与 ${UA_POOL_SIZE} 不符，请补齐`);
}

// ── 反同源连续（T11）─────────────────────────────────────────────
//
// 每个 sourceKey（含默认轨道 DEFAULT_TRACK）维护一份打乱后的轮换队列 + 游标：
// 从队列头依次取，取尽后重新打乱（保证新模式首元 ≠ 上一轮末元，避免跨界重复）。
// 这样同一源相邻请求必不重复；不同源各自独立轨道，互不影响。
// 游标单调递增（不回退），所以 50 次连续调用返回 50 个互异 UA。

const DEFAULT_TRACK = '__default__';

// 每个轨道：{ order: 打乱后的入队顺序, cursor: 当前取位 }
const uaTracks = new Map<string, { queue: string[]; cursor: number }>();

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function trackFor(key: string): { queue: string[]; cursor: number } {
  let track = uaTracks.get(key);
  if (!track) {
    track = { queue: shuffle(USER_AGENTS), cursor: 0 };
    uaTracks.set(key, track);
  }
  return track;
}

/** 测试/重置用：清空全部源的连续轨道状态。 */
export function resetUaContinuity(): void {
  uaTracks.clear();
}

/**
 * 取一条 UA，并保证**同一源连续请求不重复**（反同源连续）。
 * 不带 sourceKey 走默认轨道，保证跨源/通用请求之间也不连续。
 */
export function getUserAgent(sourceKey?: string): string {
  const trackKey = sourceKey ?? DEFAULT_TRACK;
  const track = trackFor(trackKey);
  if (track.cursor >= track.queue.length) {
    // 本轮耗尽：重打乱，且保证新队首 ≠ 上一轮末元（跨界不连续）
    const last = track.queue[track.queue.length - 1];
    const next = shuffle(USER_AGENTS);
    if (next[0] === last) {
      // 与上一轮末元相同则交换队首与队中
      [next[0], next[1]] = [next[1], next[0]];
    }
    track.queue = next;
    track.cursor = 0;
  }
  return track.queue[track.cursor++]!;
}

// ── 速率限制器（令牌桶） ─────────────────────────────────────

export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private processing = false;

  constructor(maxTokens: number = 3, refillRate: number = 2) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  private processQueue() {
    if (this.processing) return;
    this.processing = true;

    const tick = () => {
      this.refill();
      if (this.tokens >= 1 && this.queue.length > 0) {
        this.tokens -= 1;
        this.queue.shift()!();
        // 处理下一个等待者
        const waitMs = this.tokens >= 1 ? 0 : (1 / this.refillRate) * 1000;
        setTimeout(tick, waitMs);
      } else if (this.queue.length > 0) {
        // 仍有等待者但 tokens 不足，延迟重试
        setTimeout(tick, (1 / this.refillRate) * 1000);
      } else {
        this.processing = false;
      }
    };

    tick();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }
}

const globalLimiter = new RateLimiter(3, 2);

// ── 增强请求头 ──────────────────────────────────────────────

export type AntiScrapeHeaders = Record<string, string>;

function getSecChUa(ua: string): string {
  if (ua.includes('Edg/')) {
    const match = ua.match(/Edg\/(\d+)/);
    const ver = match?.[1] ?? '124';
    return `"Chromium";v="${ver}", "Microsoft Edge";v="${ver}", "Not?A_Brand";v="99"`;
  }
  if (ua.includes('Firefox')) {
    return '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
  }
  const match = ua.match(/Chrome\/(\d+)/);
  const ver = match?.[1] ?? '124';
  return `"Chromium";v="${ver}", "Google Chrome";v="${ver}", "Not?A_Brand";v="99"`;
}

/**
 * 浏览器态请求头（T11「两态」之一）：源站直连/CDN 防盗链需要完整浏览器特征时使用。
 * - `referer` 存在 → `Sec-Fetch-Site: same-origin`（CDN 防盗链放行的「同源」语义）；
 * - `sourceKey` 用于反同源连续（可选，不带则走默认轨道）；
 * - 保持 T11 前兼容：`getAntiScrapeHeaders()` / `getAntiScrapeHeaders(referer)` 仍可用。
 */
export function getAntiScrapeHeaders(referer?: string, sourceKey?: string): AntiScrapeHeaders {
  const ua = getUserAgent(sourceKey);
  const isFirefox = ua.includes('Firefox');
  const isSafari = ua.includes('Safari') && !ua.includes('Chrome');
  const isMobile = /Mobile|iPhone|iPad|Android/.test(ua);
  const secChUaMobile = ua.includes('iPhone') || ua.includes('iPad') ? '?1' : '?0';

  return {
    'User-Agent': ua,
    'Accept': isFirefox
      ? 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': isSafari || isFirefox ? '' : getSecChUa(ua),
    'Sec-Ch-Ua-Mobile': isMobile ? secChUaMobile : '?0',
    'Sec-Ch-Ua-Platform': ua.includes('Windows') ? '"Windows"' : ua.includes('Macintosh') ? '"macOS"' : ua.includes('Android') ? '"Android"' : ua.includes('iPhone') || ua.includes('iPad') ? '"iOS"' : '"Linux"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Upgrade-Insecure-Requests': '1',
    ...(referer ? { 'Referer': referer } : {}),
  };
}

/**
 * API 态请求头（T11「两态」之二）：自建搜索 API / 稳定的 JSON 端点。
 * - 最小 JSON 头，不含浏览器态 sec-ch 满套 / `Upgrade-Insecure-Requests`；
 * - 默认不带 Referer（不污染自建 API / 直连的 Host 校验）；
 * - `sourceKey` 用于反同源连续（可选）。
 */
export function getApiRequestHeaders(sourceKey?: string): AntiScrapeHeaders {
  return {
    'User-Agent': getUserAgent(sourceKey),
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
}

// ── 全局请求钩子 ─────────────────────────────────────────────

export async function beforeRequest(): Promise<void> {
  await globalLimiter.acquire();
}

// ── 容错 JSON 解析（T11 / r2 §5c）─────────────────────────────
//
// sourceUrl 源站偶发非 JSON（HTML 包裹 / 尾逗号 / 单引号 / 前导垃圾）时，
// 直接 JSON.parse 会让整链路炸掉。此处做三级降级，失败返回 null 不抛：
//   JSON.parse → 去尾逗号/HTML 包裹裁剪后再试 → 最终返回 null。
// 决策：默认启用但保守——不引入第三方 jsonrepair（避免 RN 打包体积/依赖），
// 覆盖最常见的中毒形态即可；失败交给调用方兜底（返回 null 不炸链路）。

export function safeParseJSON(text: string): unknown {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const raw = text.trim();

  try {
    return JSON.parse(raw);
  } catch {
    // 降级 1：剥离常见 HTML 包裹（<script>…</script> / <pre>…</pre> 内 JSON）
    let candidate = null as string | null;
    const script = raw.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    candidate = script ? script[1]!.trim() : null;

    // 降级 2：从「{」到文件尾裁剪出 JSON 对象 / 数组子串
    if (!candidate) {
      const objStart = raw.indexOf('{');
      const arrStart = raw.indexOf('[');
      const start = objStart === -1 ? arrStart : Math.min(objStart, arrStart);
      if (start === -1) return null;
      // 去尾逗号：裁剪到最后一个 } 或 ]
      const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
      candidate = end > start ? raw.slice(start, end + 1) : raw.slice(start);
    }

    if (!candidate) return null;
    try {
      return JSON.parse(candidate.replace(/,(\s*[}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}
