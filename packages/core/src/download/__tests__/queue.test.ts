import { describe, expect, it } from 'vitest';
import { takeNextQueued, retryBackoffMs, DEFAULT_MAX_CONCURRENT } from '../queue.js';

describe('takeNextQueued 队列并发受控', () => {
  it('并发未满时取出队首并返回剩余队列', () => {
    const { next, remaining } = takeNextQueued(['a', 'b', 'c'], 0, 3);
    expect(next).toBe('a');
    expect(remaining).toEqual(['b', 'c']);
  });

  it('并发已满（active === max）时不取任务，队列不变', () => {
    const { next, remaining } = takeNextQueued(['a', 'b'], 3, 3);
    expect(next).toBeNull();
    expect(remaining).toEqual(['a', 'b']);
  });

  it('并发超过上限也不取任务', () => {
    const { next } = takeNextQueued(['a'], 5, 3);
    expect(next).toBeNull();
  });

  it('空队列返回 null 与空剩余', () => {
    const { next, remaining } = takeNextQueued([], 0, 3);
    expect(next).toBeNull();
    expect(remaining).toEqual([]);
  });

  it('暴露默认并发上限常量（沿用现有 3）', () => {
    expect(DEFAULT_MAX_CONCURRENT).toBe(3);
  });
});

describe('retryBackoffMs 失败重试退避（指数退避，不进入死循环）', () => {
  it('按尝试次数指数退避（0..maxRetries-1 轮之间等待）', () => {
    expect(retryBackoffMs(0, 3)).toBe(1000);
    expect(retryBackoffMs(1, 3)).toBe(2000);
    expect(retryBackoffMs(2, 3)).toBe(4000);
  });

  it('最后一轮尝试失败即停止（attempt >= maxRetries 返回 -1，不再等待）', () => {
    expect(retryBackoffMs(3, 3)).toBe(-1);
    expect(retryBackoffMs(4, 3)).toBe(-1);
    expect(retryBackoffMs(3, 2)).toBe(-1);
  });
});
