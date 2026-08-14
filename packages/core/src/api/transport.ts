import axios from 'axios';

/**
 * 传输接缝（T01）—— core 请求层底部的统一可注入传输。
 *
 * 目的：让「直接客户端」（T02+ 各源官方直连）与「预检」（T12）等新请求层代码
 * 统一经 `request()` 出网；测试注入 mock 传输即可在 core 接缝上驱动全部请求层
 * 行为（成功率/回退/重试/超时），不真实出网。默认实现 = axios（双端可用），
 * 未注入时行为与现状一致。
 *
 * 使用约定：
 * - 请求体由调用方序列化（form / JSON），本层不关心内容；
 * - `responseType: 'arraybuffer'` 供需要字节内容的调用（探测/302 解析）使用；
 * - `finalUrl` 为最终地址（重定向链终点），无则回退请求 URL。
 */

export interface TransportRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** 已序列化的请求体（form / JSON 字符串）。 */
  body?: string;
  timeoutMs?: number;
  responseType?: 'text' | 'arraybuffer';
  /**
   * 内容直链标记（mp3/flac 等音频 CDN 直链）。T09 spec #155：内容直链在 TLS
   * 握手失败时允许一次降级重试（仅桌面，需注入降级 agent 提供者）。
   */
  content?: boolean;
  /**
   * TLS 降级重试标记：由 `request()` 在内容直链 TLS 握手失败后自动补上，
   * 桌面注入的传输读取此标记切换为降级 https agent（minVersion 放宽）。
   * 移动端默认实现不处理此标记（RN 无法配置 TLS），因此天然不降级。
   */
  tlsDegrade?: boolean;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string | ArrayBuffer;
  /** 重定向链终点地址；无重定向时为请求 URL。 */
  finalUrl: string;
  /** 会话失效响应（如 404「没有找到相关信息」/非法请求页）。标记后按 4xx 语义不重试。 */
  sessionInvalid?: boolean;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

let active: Transport | null = null;

/** 注入测试/桥接传输；传 null 恢复默认 axios 实现。 */
export function setTransport(transport: Transport | null): void {
  active = transport;
}

export function getTransport(): Transport | null {
  return active;
}

/** 统一请求入口：有注入传输走注入，否则走默认 axios 实现。 */
export async function request(req: TransportRequest): Promise<TransportResponse> {
  const raw = active ?? defaultTransport;
  return requestWithRetry(req, raw);
}

// ── 统一重试 + TLS 降级（T09 spec #155）────────────────────────────────

export interface TransportRetryOptions {
  /** 最大重试次数（首次尝试之外的额外次数；默认 3）。 */
  maxRetries: number;
  /** 指数退避基数（默认 100ms）：第 n 次重试前等待 base * 2^(n-1)。 */
  baseDelayMs: number;
}

const DEFAULT_RETRY_OPTIONS: TransportRetryOptions = { maxRetries: 3, baseDelayMs: 100 };
let retryOptions: TransportRetryOptions = { ...DEFAULT_RETRY_OPTIONS };

/** 重置/自定义重试策略；传 null 恢复默认（maxRetries=3，base=100ms）。 */
export function setTransportRetryOptions(options: TransportRetryOptions | null): void {
  retryOptions = options ? { ...options } : { ...DEFAULT_RETRY_OPTIONS };
}

export function getTransportRetryOptions(): TransportRetryOptions {
  return { ...retryOptions };
}

/** 内容直链 TLS 降级 agent 提供者（仅桌面主进程注入；RN 不注入）。 */
export interface TlsDegradeAgents {
  httpsAgent: unknown;
}
type TlsDegradeProvider = () => TlsDegradeAgents | null;
let tlsDegradeProvider: TlsDegradeProvider | null = null;

/** 桌面主进程注入：内容直链 TLS 握手失败时，用这里给出的降级 agent 重试一次。 */
export function setTlsDegradeProvider(provider: TlsDegradeProvider | null): void {
  tlsDegradeProvider = provider;
}

export function getTlsDegradeProvider(): TlsDegradeProvider | null {
  return tlsDegradeProvider;
}

/** 识别 TLS 握手错误码（ERR_SSL_* / ERR_TLS_*）。 */
export function isTlsHandshakeError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return (
    typeof code === 'string' &&
    (code === 'ERR_SSL' || code.startsWith('ERR_SSL_') || code.startsWith('ERR_TLS_'))
  );
}

// 可重试的网络错误码：连接/路由/超时/管道/TLS（含降级对象外层的 TLS 错误）。
const NETWORK_ERROR_CODE_RE =
  /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EHOSTDOWN|EPIPE|ERR_SSL|ERR_TLS|SOCKS)/;

function isRetryableNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; isAxiosError?: boolean; response?: unknown };
  if (typeof e.code === 'string') {
    return NETWORK_ERROR_CODE_RE.test(e.code);
  }
  // axios 网络错误（无 response）没有 code，只有 isAxiosError 标志。
  return e.isAxiosError === true && !e.response;
}

function backoffDelay(attempt: number, base: number): number {
  return base * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestWithRetry(req: TransportRequest, raw: Transport): Promise<TransportResponse> {
  const opts = retryOptions;
  let degraded = false; // 是否已做过一次降级重试
  for (let attempt = 0; ; attempt += 1) {
    const outReq: TransportRequest = degraded ? { ...req, tlsDegrade: true } : req;
    try {
      const res = await raw(outReq);
      // 4xx/2xx/3xx 与「会话失效」不重试；5xx 在预算内指数退避重试。
      const retryable = res.status >= 500 && !res.sessionInvalid;
      if (!retryable) return res;
      if (attempt >= opts.maxRetries) return res;
      await sleep(backoffDelay(attempt, opts.baseDelayMs));
    } catch (err) {
      // 内容直链 TLS 握手失败：桌面（已注入提供者）用降级配置恰好重试一次（不消耗预算）。
      if (!degraded && req.content && isTlsHandshakeError(err) && tlsDegradeProvider) {
        degraded = true;
        continue;
      }
      if (isRetryableNetworkError(err) && attempt < opts.maxRetries) {
        await sleep(backoffDelay(attempt, opts.baseDelayMs));
        continue;
      }
      throw err;
    }
  }
}

async function defaultTransport(req: TransportRequest): Promise<TransportResponse> {
  const resp = await axios.request({
    method: req.method,
    url: req.url,
    headers: req.headers,
    data: req.body,
    timeout: req.timeoutMs || 12000,
    responseType: req.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
    validateStatus: () => true,
  });
  const finalUrl = (resp.request as { responseURL?: string } | undefined)?.responseURL;
  return {
    status: resp.status,
    headers: resp.headers as Record<string, string>,
    body: resp.data as string | ArrayBuffer,
    finalUrl: finalUrl && /^https?:\/\//.test(finalUrl) ? finalUrl : req.url,
  };
}
