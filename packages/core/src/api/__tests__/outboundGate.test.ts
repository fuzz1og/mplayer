import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  acquireOutboundSlot,
  getOutboundInFlightCount,
  getOutboundQueuedCount,
  getOutboundGateStats,
  setOutboundGateOptions,
  resetOutboundGate,
  outboundHostOf,
  isTransportAbortError,
  TransportAbortError,
} from '../outboundGate.js';
import { setTransport, request, type TransportRequest } from '../transport.js';

/**
 * 出网闸门测试（#408 / ADR 2026-09-26-outbound-request-governance）。
 *
 * 断言的是**接口不变量**而不是实现：
 * - 并发峰值 ≤ 全局上限、同一 host 并发峰值 ≤ 每 host 上限；
 * - 同 host 严格 FIFO；跨 host 不被队首阻塞；
 * - 取消的请求**永不进入底层传输**，且从队列里消失。
 */

/** 手搓 signal：不赌 AbortController 的全局可用性，且 abort 时机可精确控制。 */
function fakeSignal() {
  const listeners = new Set<() => void>();
  let aborted = false;
  const signal = {
    get aborted() {
      return aborted;
    },
    addEventListener: (type: 'abort', listener: () => void) => {
      if (type === 'abort') listeners.add(listener);
    },
    removeEventListener: (type: 'abort', listener: () => void) => {
      listeners.delete(listener);
    },
  };
  return {
    signal,
    abort() {
      aborted = true;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

/** 让出一轮微任务，令已 resolve 的 acquire 回调落地。 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetOutboundGate();
  setTransport(null);
});
afterEach(() => {
  resetOutboundGate();
  setTransport(null);
});

describe('outboundHostOf', () => {
  it('取 host 并小写；非 http(s) 归 unknown', () => {
    expect(outboundHostOf('https://Music.163.com/api/song/lyric')).toBe('music.163.com');
    expect(outboundHostOf('http://127.0.0.1:8080/a?b=1')).toBe('127.0.0.1:8080');
    expect(outboundHostOf('file:///tmp/a.mp3')).toBe('unknown');
  });
});

describe('双层在飞闸门', () => {
  it('全局上限：超出即排队，释放后按序放行', async () => {
    setOutboundGateOptions({ maxGlobal: 2, maxPerHost: 10 });
    const r1 = await acquireOutboundSlot('https://a.example/1');
    const r2 = await acquireOutboundSlot('https://b.example/1');
    const queued = acquireOutboundSlot('https://c.example/1');

    expect(getOutboundInFlightCount()).toBe(2);
    expect(getOutboundQueuedCount()).toBe(1);

    r1();
    const r3 = await queued;
    expect(getOutboundInFlightCount()).toBe(2);
    expect(getOutboundQueuedCount()).toBe(0);

    r2();
    r3();
    expect(getOutboundInFlightCount()).toBe(0);
    expect(getOutboundGateStats().peakInFlight).toBe(2);
  });

  it('每 host 上限：同 host 第三个起排队，别的 host 不被队首阻塞', async () => {
    setOutboundGateOptions({ maxGlobal: 10, maxPerHost: 2 });
    const a1 = await acquireOutboundSlot('https://a.example/1');
    const a2 = await acquireOutboundSlot('https://a.example/2');
    const a3 = acquireOutboundSlot('https://a.example/3');
    const a4 = acquireOutboundSlot('https://a.example/4');

    expect(getOutboundQueuedCount()).toBe(2);

    // 跨 host：a 的两个等待者在前，但 b 的 host 还有容量 → 直接放行。
    const b1 = await acquireOutboundSlot('https://b.example/1');
    expect(getOutboundInFlightCount()).toBe(3);
    expect(getOutboundQueuedCount()).toBe(2);

    // 同 host FIFO：释放 a1 只能放行 a3（先入队者），不是 a4。
    a1();
    const r3 = await a3;
    expect(getOutboundQueuedCount()).toBe(1);

    a2();
    const r4 = await a4;
    expect(getOutboundQueuedCount()).toBe(0);
    expect(getOutboundGateStats().peakPerHost).toBe(2);

    r3();
    r4();
    b1();
    expect(getOutboundInFlightCount()).toBe(0);
  });

  it('归还函数幂等：重复调用不会把计数减穿', async () => {
    setOutboundGateOptions({ maxGlobal: 1, maxPerHost: 1 });
    const release = await acquireOutboundSlot('https://a.example/1');
    const queued = acquireOutboundSlot('https://a.example/2');
    release();
    release();
    release();
    const second = await queued;
    expect(getOutboundInFlightCount()).toBe(1);
    second();
    expect(getOutboundInFlightCount()).toBe(0);
  });
});

describe('取消', () => {
  it('已 abort 的 signal：立即 reject，且不占队列', async () => {
    const { signal, abort } = fakeSignal();
    abort();
    await expect(acquireOutboundSlot('https://a.example/1', signal)).rejects.toBeInstanceOf(TransportAbortError);
    expect(getOutboundQueuedCount()).toBe(0);
    expect(getOutboundInFlightCount()).toBe(0);
  });

  it('排队期间 abort：从队列摘除并 reject，槽位不被占用', async () => {
    setOutboundGateOptions({ maxGlobal: 1, maxPerHost: 1 });
    const release = await acquireOutboundSlot('https://a.example/1');
    const { signal, abort, listenerCount } = fakeSignal();

    const pending = acquireOutboundSlot('https://a.example/2', signal);
    expect(getOutboundQueuedCount()).toBe(1);
    expect(listenerCount()).toBe(1);

    abort();
    await expect(pending).rejects.toBeInstanceOf(TransportAbortError);
    expect(getOutboundQueuedCount()).toBe(0);
    // abort 监听器必须摘掉（否则长命 signal 上会累积闭包）。
    expect(listenerCount()).toBe(0);

    // 闸门仍然可用：取消不泄漏槽位。
    release();
    const next = await acquireOutboundSlot('https://a.example/3');
    next();
    expect(getOutboundInFlightCount()).toBe(0);
  });

  it('resetOutboundGate 让等待者以取消结算（不留悬空 promise）', async () => {
    setOutboundGateOptions({ maxGlobal: 1, maxPerHost: 1 });
    await acquireOutboundSlot('https://a.example/1');
    const pending = acquireOutboundSlot('https://a.example/2');
    resetOutboundGate();
    await expect(pending).rejects.toBeInstanceOf(TransportAbortError);
    expect(getOutboundQueuedCount()).toBe(0);
    expect(getOutboundInFlightCount()).toBe(0);
  });

  it('isTransportAbortError 只认取消，不认网络错误', () => {
    expect(isTransportAbortError(new TransportAbortError())).toBe(true);
    expect(isTransportAbortError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(false);
    expect(isTransportAbortError(new Error('x'))).toBe(false);
    expect(isTransportAbortError(null)).toBe(false);
  });
});

describe('transport.request 经闸门出网', () => {
  const ok = (req: TransportRequest) => ({ status: 200, headers: {}, body: 'ok', finalUrl: req.url });

  it('并发峰值受每 host 上限约束（同一 host 连发 5 条）', async () => {
    setOutboundGateOptions({ maxGlobal: 6, maxPerHost: 2 });
    let inFlight = 0;
    let peak = 0;
    setTransport(async (req) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return ok(req);
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => request({ method: 'GET', url: 'https://a.example/' + i })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(peak).toBe(2);
    expect(getOutboundInFlightCount()).toBe(0);
  });

  it('不同 host 同时出网（全局上限内不互相排队）', async () => {
    setOutboundGateOptions({ maxGlobal: 6, maxPerHost: 1 });
    let inFlight = 0;
    let peak = 0;
    setTransport(async (req) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return ok(req);
    });

    await Promise.all(
      ['a', 'b', 'c'].map((h) => request({ method: 'GET', url: 'https://' + h + '.example/x' })),
    );
    expect(peak).toBe(3);
  });

  it('在飞期间 abort：底层传输只被调用一次，取消不重试', async () => {
    setOutboundGateOptions({ maxGlobal: 6, maxPerHost: 2 });
    let attempts = 0;
    setTransport(async (req) => {
      attempts += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      if (req.signal?.aborted) {
        // 模拟 axios：取消表现为「无 response 的网络错误」——闸门必须把它当取消而不是可重试。
        throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', isAxiosError: true });
      }
      return ok(req);
    });

    const { signal, abort } = fakeSignal();
    const pending = request({ method: 'GET', url: 'https://a.example/slow', signal });
    setTimeout(abort, 5);
    await expect(pending).rejects.toBeInstanceOf(TransportAbortError);
    expect(attempts).toBe(1);
    expect(getOutboundInFlightCount()).toBe(0);
  });

  it('请求完成后闸门归零（成功与失败都不泄漏槽位）', async () => {
    setOutboundGateOptions({ maxGlobal: 6, maxPerHost: 2 });
    setTransport(async (req) => {
      if (req.url.endsWith('/boom')) throw Object.assign(new Error('net'), { code: 'ECONNRESET' });
      return ok(req);
    });
    await request({ method: 'GET', url: 'https://a.example/1' });
    await expect(request({ method: 'GET', url: 'https://a.example/boom' })).rejects.toBeTruthy();
    expect(getOutboundInFlightCount()).toBe(0);
    expect(getOutboundQueuedCount()).toBe(0);
  });
});
