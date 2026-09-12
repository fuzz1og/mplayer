import { describe, expect, it, vi } from 'vitest';
import { createReducedMotionStore, type ReducedMotionSource } from '../services/reducedMotion';

function fakeSource(initial = false) {
  const handlers: ((enabled: boolean) => void)[] = [];
  const source: ReducedMotionSource = {
    isReduceMotionEnabled: vi.fn(async () => initial),
    addEventListener: vi.fn((handler: (enabled: boolean) => void) => {
      handlers.push(handler);
      return { remove: vi.fn() };
    }),
  };
  return { source, emit: (enabled: boolean) => handlers.forEach((h) => h(enabled)) };
}

/** 等异步取值 settle */
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

describe('createReducedMotionStore', () => {
  it('多消费者共享：只触发一次取值 + 一个监听器', async () => {
    const { source } = fakeSource(true);
    const store = createReducedMotionStore(source);
    // 15 行 × 6 订阅 = 90 个消费者
    const listeners = Array.from({ length: 90 }, () => vi.fn());
    const unsubscribes = listeners.map((listener) => store.subscribe(listener));

    expect(source.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(source.addEventListener).toHaveBeenCalledTimes(1);
    // 初值与旧 hook 一致：异步取值回来前为 false
    expect(store.getSnapshot()).toBe(false);

    await flush();
    expect(store.getSnapshot()).toBe(true);
    for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(1);

    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('事件推送更新缓存值；值未变化不通知', async () => {
    const { source, emit } = fakeSource(false);
    const store = createReducedMotionStore(source);
    const listener = vi.fn();
    store.subscribe(listener);

    await flush();
    expect(listener).not.toHaveBeenCalled(); // false → false
    emit(true);
    expect(store.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    emit(true);
    expect(listener).toHaveBeenCalledTimes(1); // 同值不通知
    emit(false);
    expect(store.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('退订后不再收到通知，共享监听器继续服务其他订阅者', () => {
    const { source, emit } = fakeSource(false);
    const store = createReducedMotionStore(source);
    const a = vi.fn();
    const b = vi.fn();
    const offA = store.subscribe(a);
    store.subscribe(b);

    offA();
    emit(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(source.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('系统取值失败：保持初值且不抛', async () => {
    const source: ReducedMotionSource = {
      isReduceMotionEnabled: vi.fn(async () => { throw new Error('boom'); }),
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    };
    const store = createReducedMotionStore(source);
    store.subscribe(vi.fn());
    await flush();
    expect(store.getSnapshot()).toBe(false);
  });
});
