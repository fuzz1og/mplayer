/**
 * 反爬工具模块
 * 提供 User-Agent 轮换、速率限制、随机延迟、增强请求头等能力
 */

// ── User-Agent 池 ──────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

export function getAntiScrapeHeaders(referer?: string): AntiScrapeHeaders {
  const ua = getRandomUserAgent();
  const isFirefox = ua.includes('Firefox');
  const isSafari = ua.includes('Safari') && !ua.includes('Chrome');

  return {
    'User-Agent': ua,
    'Accept': isFirefox
      ? 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': isSafari ? '' : getSecChUa(ua),
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': ua.includes('Windows') ? '"Windows"' : ua.includes('Macintosh') ? '"macOS"' : '"Linux"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Upgrade-Insecure-Requests': '1',
  };
}

// ── 全局请求钩子 ─────────────────────────────────────────────

export async function beforeRequest(): Promise<void> {
  await globalLimiter.acquire();
}
