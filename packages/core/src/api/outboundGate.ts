import type { TransportSignal } from './transport.js';

/**
 * 出网闸门（#408 / ADR `2026-09-26-outbound-request-governance`）。
 *
 * 位置：`transport.request()` 的**内部接缝**——不属于公开接口，调用方感知不到排队，
 * 只继承「同一时间出网请求不会失控」这条纪律。
 *
 * 形态（对齐 ADR `2026-09-25-tier3-source-scheduling` 决策 8 已确立的立场）：
 * - **双层在飞上限**：全局 + 每 host。全局必须大于任何单腿自己的上限（tier3 K=3 /
 *   下载 3 / 搜索 3），否则单腿会被外层闸门自我饿死；取 6 = 两条腿各自跑满。
 * - **每 host 2**：「同一主机不要有两条以上在飞」能覆盖绝大多数风控形态；
 *   这是起步值而非结论值，靠 `getOutboundGateStats()` 判定是否要调。
 * - **同 host 严格 FIFO**；跨 host 允许越过被 host 容量挡住的队首（避免队首阻塞）。
 * - **排队期间响应 abort**：从队列摘除并 reject；被 abort 的请求**绝不调用底层传输**。
 *
 * 不做的事（见 ADR 备选与否决）：不感知墙钟（墙的语义属各腿，见 #399）、
 * 不做每 host 最小间隔 pacing（需要按源配参数与实测数据）、队列超限不立即失败。
 */

export interface OutboundGateOptions {
  /** 全局在飞上限。 */
  maxGlobal: number;
  /** 单个 host 在飞上限。 */
  maxPerHost: number;
}

export const DEFAULT_OUTBOUND_GATE: OutboundGateOptions = { maxGlobal: 6, maxPerHost: 2 };

export interface OutboundGateStats {
  /** 当前在飞请求数。 */
  inFlight: number;
  /** 当前排队等待数。 */
  queued: number;
  /** 会话内全局在飞峰值。 */
  peakInFlight: number;
  /** 会话内单 host 在飞峰值。 */
  peakPerHost: number;
  /** 会话内最长排队等待（ms）。 */
  maxQueueWaitMs: number;
  options: OutboundGateOptions;
}

/** 取到槽位后必须调用的归还函数（幂等）。 */
export type ReleaseOutboundSlot = () => void;

/** 取消错误：与网络错误区分开，**不可重试**。 */
export class TransportAbortError extends Error {
  constructor(message = 'request aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isTransportAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
}

let options: OutboundGateOptions = { ...DEFAULT_OUTBOUND_GATE };
let globalInFlight = 0;
const perHostInFlight = new Map<string, number>();
let peakInFlight = 0;
let peakPerHost = 0;
let maxQueueWaitMs = 0;

interface Waiter {
  host: string;
  enqueuedAt: number;
  settled: boolean;
  resolve: (release: ReleaseOutboundSlot) => void;
  reject: (err: unknown) => void;
  detachAbort?: () => void;
}

const waiters: Waiter[] = [];

/** 请求 URL 的 host（不依赖 URL 解析：RN 的 polyfill 行为不必赌）。 */
export function outboundHostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : 'unknown';
}

function release(host: string): void {
  const current = perHostInFlight.get(host) ?? 0;
  if (current <= 1) perHostInFlight.delete(host);
  else perHostInFlight.set(host, current - 1);
  globalInFlight = Math.max(0, globalInFlight - 1);
  pump();
}

function makeRelease(host: string): ReleaseOutboundSlot {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release(host);
  };
}

function fits(host: string): boolean {
  return globalInFlight < options.maxGlobal && (perHostInFlight.get(host) ?? 0) < options.maxPerHost;
}

function take(host: string): ReleaseOutboundSlot {
  const hostInFlight = perHostInFlight.get(host) ?? 0;
  globalInFlight += 1;
  perHostInFlight.set(host, hostInFlight + 1);
  if (globalInFlight > peakInFlight) peakInFlight = globalInFlight;
  if (hostInFlight + 1 > peakPerHost) peakPerHost = hostInFlight + 1;
  return makeRelease(host);
}

/** 按 FIFO 放行所有装得下的等待者；跨 host 允许越过被 host 容量挡住的队首。 */
function pump(): void {
  for (let i = 0; i < waiters.length; ) {
    const waiter = waiters[i];
    if (!fits(waiter.host)) {
      i += 1;
      continue;
    }
    waiters.splice(i, 1);
    waiter.settled = true;
    const waited = Date.now() - waiter.enqueuedAt;
    if (waited > maxQueueWaitMs) maxQueueWaitMs = waited;
    detachAbort(waiter);
    waiter.resolve(take(waiter.host));
  }
}

function detachAbort(waiter: Waiter): void {
  waiter.detachAbort?.();
  waiter.detachAbort = undefined;
}

/**
 * 取一个出网槽位：有空位立即返回；否则 FIFO 排队。
 * `signal` 已 abort 时立即 reject；排队期间 abort 则从队列摘除并 reject。
 */
export function acquireOutboundSlot(url: string, signal?: TransportSignal): Promise<ReleaseOutboundSlot> {
  const host = outboundHostOf(url);
  if (signal?.aborted) return Promise.reject(new TransportAbortError());
  if (fits(host)) return Promise.resolve(take(host));
  return new Promise<ReleaseOutboundSlot>((resolve, reject) => {
    const waiter: Waiter = { host, enqueuedAt: Date.now(), settled: false, resolve, reject };
    if (signal?.addEventListener) {
      const onAbort = () => {
        if (waiter.settled) return;
        waiter.settled = true;
        const idx = waiters.indexOf(waiter);
        if (idx >= 0) waiters.splice(idx, 1);
        detachAbort(waiter);
        reject(new TransportAbortError());
      };
      signal.addEventListener('abort', onAbort);
      waiter.detachAbort = () => signal.removeEventListener?.('abort', onAbort);
    }
    waiters.push(waiter);
  });
}

export function getOutboundGateOptions(): OutboundGateOptions {
  return { ...options };
}

/** 覆盖闸门上限；传 null 恢复默认（全局 6 / 每 host 2）。测试与真机调参接缝。 */
export function setOutboundGateOptions(next: Partial<OutboundGateOptions> | null): void {
  options = next ? { ...DEFAULT_OUTBOUND_GATE, ...next } : { ...DEFAULT_OUTBOUND_GATE };
  pump();
}

export function getOutboundInFlightCount(): number {
  return globalInFlight;
}

export function getOutboundQueuedCount(): number {
  return waiters.length;
}

/** 设置页诊断用最小集合（读侧，不进请求热路径）。 */
export function getOutboundGateStats(): OutboundGateStats {
  return {
    inFlight: globalInFlight,
    queued: waiters.length,
    peakInFlight,
    peakPerHost,
    maxQueueWaitMs,
    options: { ...options },
  };
}

/** 测试/重置：清空队列（等待者按取消结算）、计数与峰值。 */
export function resetOutboundGate(): void {
  const pending = waiters.splice(0);
  globalInFlight = 0;
  perHostInFlight.clear();
  peakInFlight = 0;
  peakPerHost = 0;
  maxQueueWaitMs = 0;
  options = { ...DEFAULT_OUTBOUND_GATE };
  for (const waiter of pending) {
    if (waiter.settled) continue;
    waiter.settled = true;
    detachAbort(waiter);
    waiter.reject(new TransportAbortError('outbound gate reset'));
  }
}
