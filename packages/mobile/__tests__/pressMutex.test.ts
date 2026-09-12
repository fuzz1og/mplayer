import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPressMutex } from '../services/pressMutex';

describe('createPressMutex', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('认领后行按压被吞掉一次，随后恢复', () => {
    const mutex = createPressMutex();
    expect(mutex.consumeRowPress()).toBe(false);
    mutex.claimInner();
    expect(mutex.consumeRowPress()).toBe(true);
    expect(mutex.consumeRowPress()).toBe(false);
  });

  it('窗口期内没有行按压也会自动释放（不吞下一次真实点击）', () => {
    vi.useFakeTimers();
    const mutex = createPressMutex(100);
    mutex.claimInner();
    vi.advanceTimersByTime(100);
    expect(mutex.consumeRowPress()).toBe(false);
  });

  it('重复认领重置窗口（以最后一次内层按压为准）', () => {
    vi.useFakeTimers();
    const mutex = createPressMutex(100);
    mutex.claimInner();
    vi.advanceTimersByTime(60);
    mutex.claimInner();
    vi.advanceTimersByTime(60); // 距第二次认领 60ms < 100ms
    expect(mutex.consumeRowPress()).toBe(true);
  });

  it('dispose 释放认领与定时器', () => {
    vi.useFakeTimers();
    const mutex = createPressMutex(100);
    mutex.claimInner();
    expect(vi.getTimerCount()).toBe(1);
    mutex.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(mutex.consumeRowPress()).toBe(false);
  });
});
