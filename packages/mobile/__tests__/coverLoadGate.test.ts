import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoverLoadGate } from '../services/coverLoadGate';

/**
 * 封面在飞闸门（#496）纯逻辑测试。
 *
 * 覆盖四条契约：
 * 1. 上限内立即到手、超限 FIFO 排队；
 * 2. release() 幂等——重复调用只归还一个槽位（onLoad + 卸载会各调一次）；
 * 3. 排队期间取消 = 从队列摘除，不占额度也不参与放行；
 * 4. 槽位墙钟（死锁自愈）——持有者一直不回调时强制归还并放行队首。
 *
 * 计时器全部用 fake timers：槽位自带 20s 墙钟，真计时器会让用例挂住。
 */

/** 让 ready.then 的回调跑完（槽位是同步 resolve，一个微任务足够） */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

/** 登记槽位到手顺序（同一数组后续会继续被追加，引用不变） */
function watch(slots: { ready: Promise<void> }[]): number[] {
  const granted: number[] = [];
  slots.forEach((slot, i) => { void slot.ready.then(() => granted.push(i)); });
  return granted;
}

describe('CoverLoadGate', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('上限内立即到手，不排队', async () => {
    const gate = new CoverLoadGate(3, 20000);
    const slots = [gate.acquire(), gate.acquire(), gate.acquire()];
    const granted = watch(slots);
    await flush();
    expect(granted).toEqual([0, 1, 2]);
    expect(gate.stats()).toMatchObject({ inFlight: 3, waiting: 0, granted: 3, peak: 3 });
  });

  it('超限按 FIFO 排队，释放一个放行队首', async () => {
    const gate = new CoverLoadGate(2, 20000);
    const slots = [gate.acquire(), gate.acquire(), gate.acquire(), gate.acquire()];
    const granted = watch(slots);
    await flush();
    expect(granted).toEqual([0, 1]);
    expect(gate.stats()).toMatchObject({ inFlight: 2, waiting: 2, granted: 2 });
    slots[0].release();
    await flush();
    expect(granted).toEqual([0, 1, 2]);
    expect(gate.stats()).toMatchObject({ inFlight: 2, waiting: 1, granted: 3 });
  });

  it('release 幂等：重复释放不会放大额度', async () => {
    const gate = new CoverLoadGate(1, 20000);
    const a = gate.acquire();
    const b = gate.acquire();
    await flush();
    a.release();
    a.release();
    a.release();
    await flush();
    // b 顶上来；a 的重复释放没有把额度放大成 2
    expect(gate.stats()).toMatchObject({ inFlight: 1, waiting: 0, granted: 2 });
    b.release();
    await flush();
    expect(gate.stats()).toMatchObject({ inFlight: 0, waiting: 0, granted: 2 });
  });

  it('排队期间取消：摘出队列，不占额度也不被放行', async () => {
    const gate = new CoverLoadGate(1, 20000);
    const a = gate.acquire();
    const b = gate.acquire();
    const c = gate.acquire();
    const granted = watch([a, b, c]);
    await flush();
    expect(granted).toEqual([0]);
    b.release();
    await flush();
    expect(gate.stats()).toMatchObject({ inFlight: 1, waiting: 1 });
    a.release();
    await flush();
    expect(granted).toEqual([0, 2]);
    expect(gate.stats()).toMatchObject({ inFlight: 1, waiting: 0, granted: 2 });
    c.release();
    await flush();
    expect(gate.stats()).toMatchObject({ inFlight: 0, waiting: 0 });
  });

  it('槽位墙钟：持有者不回调也强制归还并放行队列', async () => {
    const gate = new CoverLoadGate(1, 20000);
    const a = gate.acquire();
    const b = gate.acquire();
    const granted = watch([a, b]);
    await flush();
    expect(granted).toEqual([0]);
    expect(gate.stats()).toMatchObject({ inFlight: 1, waiting: 1 });

    vi.advanceTimersByTime(20000);
    await flush();
    // 墙钟到点：a 被强制归还，b 立刻顶上，额度没有被放大
    expect(granted).toEqual([0, 1]);
    expect(gate.stats()).toMatchObject({ inFlight: 1, waiting: 0, granted: 2, peak: 1 });
    b.release();
    await flush();
    expect(gate.stats()).toMatchObject({ inFlight: 0, waiting: 0 });
  });
});
